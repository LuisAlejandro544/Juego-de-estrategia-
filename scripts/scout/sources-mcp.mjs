// sources-mcp.mjs — Integración MCP real del scout.
// 1) Cliente HTTP "Streamable" de MCP (JSON-RPC 2.0) contra mcp.himalayas.app,
//    que expone tool público search_jobs sin autenticación.
// 2) Cliente stdio opcional para upwork-mcp (@furkankoykiran/upwork-mcp),
//    activado solo si el usuario define UPWORK_MCP_ENABLE=1 + credenciales.

import { spawn } from "node:child_process";
import { HIMALAYAS_MCP_URL, UA, stripHtml, UPWORK_MCP_CMD, markOk, markFail } from "./config.mjs";
import { injectRate } from "./sources-api.mjs";

const PROTOCOL = "2025-06-18"; // versión del protocolo MCP que exigimos

// Petición JSON-RPC y parseo del cho tipo respuesta (JSON puro o flujo SSE).
async function rpcFetch(url, sessionId, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "User-Agent": UA,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`HTTP ${res.status} en MCP ${url}`);

  if (ct.includes("text/event-stream")) {
    // El servidor nos contesta como SSE: extraer los bloques "data: {...}"
    const raw = await res.text();
    const idMatch = String(payload.id ?? "");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        if (!evt.id || String(evt.id) === idMatch) return evt;
      } catch { /* evento no-JSON (keepalive): se ignora */ }
    }
    throw new Error("Respuesta SSE sin ningún evento JSON");
  }
  return res.json();
}

export function createMcpHttp(baseUrl) {
  let sessionId = "";
  let nextId = 1;

  return {
    async connect() {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "User-Agent": UA,
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: nextId++, method: "initialize",
          params: {
            protocolVersion: PROTOCOL,
            capabilities: {},
            clientInfo: { name: "job-scout.mjs", version: "2.0" },
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`initialize → HTTP ${res.status}`);
      sessionId = res.headers.get("mcp-session-id") || "";
      // El servidor exige confirmarnos antes de llamar tools
      await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "mcp-session-id": sessionId, "User-Agent": UA },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }).catch(() => {});
      return true;
    },

    // Lista los tools disponibles con su esquema de entrada.
    async listTools() {
      const r = await rpcFetch(baseUrl, sessionId, { jsonrpc: "2.0", id: nextId++, method: "tools/list" });
      if (r.error) throw new Error(`tools/list: ${r.error.message}`);
      return r.result?.tools || [];
    },

    // Invoca un tool con argumentos; devuelve result.content o lanza error MCP.
    async callTool(name, args) {
      const r = await rpcFetch(baseUrl, sessionId, {
        jsonrpc: "2.0", id: nextId++, method: "tools/call",
        params: { name, arguments: args },
      });
      if (r.error) throw new Error(`${name}: ${r.error.message}`);
      const err = r.result?.isError;
      const text = (r.result?.content || []).map(c => c.text || "").join("\n");
      if (err && !text) throw new Error(`${name}: el tool devolvió isError`);
      return text;
    },
  };
}

// Intenta llamar search_jobs con el esquema de argumentos que el servidor
// declare en tools/list (los nombres varían entre servidores MCP).
function buildSearchArgs(schema, q) {
  const props = schema?.properties || Object.keys(schema || {});
  const names = Array.isArray(props) ? props : Object.keys(props);
  const args = {};
  if (names.includes("q")) args.q = q;
  else if (names.includes("keyword")) args.keyword = q;
  else if (names.includes("query")) args.query = q;
  else if (names.includes("term")) args.term = q;
  else args.q = q; // supuesto razonable por defecto
  if (names.includes("sort")) args.sort = "recent";
  if (names.includes("page")) args.page = 1;
  return args;
}

// Convierte la salida textual/JSON del tool en ofertas normalizadas.
// El MCP de Himalayas contesta en markdown tipo:
//   🚀 **Título** / 🏢 Empresa / 🕘 Full-time • 🌍 Remote / 💵 $10 - $12 USD
//   🔗 **Apply on Himalayas:** https://...
export function parseMcpMarkdownJobs(text, sourceTag) {
  const out = [];
  const blockRe = /🚀 \*\*((?:[^*]|\*(?!\*))+)\*\*/g; // cada oferta empieza con 🚀 **Título**
  let m;
  const starts = [];
  while ((m = blockRe.exec(text)) !== null) starts.push({ title: m[1].trim(), idx: m.index });
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i].idx, starts[i + 1] ? starts[i + 1].idx : text.length);
    const companyName = (block.match(/🏢 ([^\n]+)/) || [])[1]?.replace(/\s*✅\s*$/, "").trim() || "";
    const location = (block.match(/🕘 [^\n]*•\s*(🌍.*)?/) || [])[0]?.replace(/🕘 |Full-time • |Part-time • |Contractor • /g, "").trim() || "";
    const pay = (block.match(/💵 ([^\n]+)?/) || [])[1]?.trim() || "no listado";
    const url = (block.match(/https:\/\/[^\s)]+/g) || []).find(u => u.includes("/jobs/") || u.includes("jobs/paid")) || (block.match(/https:\/\/[^\s)]+/g) || [])[0] || "";
    if (!starts[i].title || !url) continue;
    out.push({
      source: sourceTag,
      url,
      title: starts[i].title,
      date: NaN, // el markdown no trae fecha de publicación
      dateUnknown: true,
      country: location || "remote",
      snippet: companyName ? `Empresa: ${companyName}` : "",
      companyName,
      pay,
    });
  }
  return out;
}

function parseMcpJsonJobs(text, sourceTag) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const rows = Array.isArray(data) ? data : (data.jobs || data.results || data.items || (data.job ? [data.job] : []));
  return rows.map(j => ({
    source: sourceTag,
    url: j.url || j.applicationLink || j.link || j.guid || "",
    title: j.title || j.jobTitle || j.position || "",
    date: new Date(j.pubDate || j.publishedAt || j.publication_date || j.date || Date.now()).getTime(),
    country: j.country || j.location || (Array.isArray(j.locationRestrictions) ? j.locationRestrictions.join(", ") : "") || "remote",
    snippet: stripHtml(j.excerpt || j.description || j.jobDescription || j.summary),
    companyName: j.companyName || j.company || "",
    pay: j.pay || (j.minSalary ? `${j.currency || "USD"} $${j.minSalary}-$${j.maxSalary}/${j.salaryPeriod || ""}` : "") || "no listado",
  })).filter(j => j.title && j.url);
}

// ---- Fuente 6: MCP de Himalayas (Streamable HTTP, sin claves) ----
// Llamamos al tool público search_jobs por keyword móvil; probamos primero el
// único tool estructurado disponible y parseamos JSON; si el servidor contesta
// en markdown, usamos el parser de bloques.
export async function fetchMcpJobs(keyword) {
  try {
    const mcp = createMcpHttp(HIMALAYAS_MCP_URL);
    await mcp.connect();
    const tools = await mcp.listTools();
    const search = tools.find(t => t.name === "search_jobs") || tools.find(t => /search.*job|job.*search/i.test(t.name));
    if (!search) {
      markFail("Himalayas MCP", "no se encontró tool de búsqueda");
      console.error("[MCP himalayas] no se encontró un tool de búsqueda disponible");
      return [];
    }
    const args = buildSearchArgs(search.inputSchema, keyword);
    if (args.term) delete args.term; // el esquema real usa "keyword"
    const out = await mcp.callTool(search.name, args);
    // Limitamos a 5: el MCP no informa fecha, no podemos aplicar el filtro <24h
    let jobs = parseMcpJsonJobs(out, "Himalayas MCP").map(j => ({ ...j, dateUnknown: Number.isNaN(j.date) }));
    if (jobs.length === 0) jobs = parseMcpMarkdownJobs(out, "Himalayas MCP");
    jobs = jobs.slice(0, 5).map(injectRate);
    markOk("Himalayas MCP", jobs.length, `q="${keyword}"`);
    console.log(`[MCP himalayas] ${jobs.length} ofertas vía '${search.name}' ("${keyword}")`);
    return jobs;
  } catch (e) {
    markFail("Himalayas MCP", e.message);
    console.error(`[MCP himalayas] falló: ${e.message}`);
    return [];
  }
}

// ---- Fuente 7 (opcional): upwork-mcp por stdio ----
// Solo corre si UPWORK_MCP_ENABLE=1: requiere OAuth interactivo previo
// (`npx -y @furkankoykiran/upwork-mcp auth`) con credenciales guardadas.
// En GitHub Actions no hay accessToken, por eso está deshabilitada por defecto.
export async function fetchUpworkMcp(keyword) {
  if (process.env.UPWORK_MCP_ENABLE !== "1") {
    markOk("Upwork MCP", 0, "deshabilitado (sin credenciales)");
    return [];
  }
  return await new Promise(resolve => {
    let buf = "";
    const child = spawn(UPWORK_MCP_CMD[0], UPWORK_MCP_CMD.slice(1), {
      env: { ...process.env },
    });
    const send = obj => child.stdin.write(`${JSON.stringify(obj)}\n`);

    const timeout = setTimeout(() => { child.kill(); markFail("Upwork MCP", "timeout esperando respuesta stdio"); resolve([]); }, 45000);
    child.stdout.on("data", d => {
      buf += d.toString();
      let idx;
      // Responde a lo que llegue línea a línea (JSON por línea en stdio MCP)
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }

        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_jobs", arguments: { keyword, sort: "recency" } } });
        } else if (msg.id === 2) {
          clearTimeout(timeout);
          const text = (msg.result?.content || []).map(c => c.text || "").join("\n");
          const jobs = (parseMcpJsonJobs(text, "Upwork").length ? parseMcpJsonJobs(text, "Upwork") : parseMcpMarkdownJobs(text, "Upwork")).map(injectRate);
          // Los issues de Upwork traen propuestas y pago verificado en el payload
          for (const j of jobs) {
            j.verified = j.snippet.includes("verified") || msg.result?.meta?.payment_verified === true;
            j.proposals = msg.result?.meta?.proposals ?? null;
          }
          markOk("Upwork MCP", jobs.length, `q="${keyword}"`);
          console.log(`[MCP upwork] ${jobs.length} ofertas vía search_jobs ("${keyword}")`);
          child.kill();
          resolve(jobs);
        }
      }
    });
    child.on("error", () => { clearTimeout(timeout); markFail("Upwork MCP", "no se pudo lanzar el proceso stdio"); resolve([]); });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "job-scout.mjs", version: "2.0" } } });
  });
}
