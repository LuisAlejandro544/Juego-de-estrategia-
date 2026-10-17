// sources-api.mjs — Fuente API/RSS públicas de la web (sin tokens, sin MCP).
// Cada función devuelve [{source,url,title,date,country,verified,pay,snippet}]
// y captura sus propios errores para no tumbar al resto del scout.

import { SOURCES, HIMALAYAS_API_KEY, UA, stripHtml, detectHourlyRate } from "./config.mjs";

// Cabeceras comunes
function headers() {
  const h = { "User-Agent": UA };
  if (HIMALAYAS_API_KEY) h.Authorization = `Bearer ${HIMALAYAS_API_KEY}`;
  return h;
}

async function jsonGet(url) {
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

// ---- Remotive API (JSON con fecha y descripción) ----
export async function fetchRemotive() {
  try {
    const data = await jsonGet(SOURCES.remotive);
    return (data.jobs || []).map(j => ({
      source: "Remotive",
      url: j.url,
      title: j.title,
      date: new Date(j.publication_date).getTime(),
      country: j.candidate_required_location || "remote",
      snippet: stripHtml(j.description),
      companyName: j.company_name || "",
    }));
  } catch (e) {
    console.error(`[Remotive] falló: ${e.message}`);
    return [];
  }
}

// ---- RemoteOK API ----
// Devuelve un array cuyo primer elemento es un aviso legal; se salta.
export async function fetchRemoteOK() {
  try {
    const data = await jsonGet(SOURCES.remoteok);
    return (Array.isArray(data) ? data.slice(1) : [])
      .map(j => ({
        source: "RemoteOK",
        url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`,
        title: j.position || j.title || "",
        date: j.date ? new Date(j.date).getTime() : NaN,
        country: j.location || "remote",
        snippet: stripHtml(j.description),
        companyName: j.company || "",
      }))
      .filter(j => j.title && !Number.isNaN(j.date));
  } catch (e) {
    console.error(`[RemoteOK] falló: ${e.message}`);
    return [];
  }
}

// ---- Helper: parsear un bloque RSS genérico ----
export function parseRss(xml, maxItems = 60) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const clean = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = m[1];
    const get = tag => {
      const t = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
      return t ? clean(t[1]) : "";
    };
    const date = new Date(get("pubDate")).getTime();
    const title = clean(get("title"));
    const link = get("link");
    if (title && link && !Number.isNaN(date)) {
      items.push({ title, url: link, date, snippet: stripHtml(get("description")) });
    }
  }
  return items;
}

// ---- WeWorkRemotely RSS de programación ----
export async function fetchWWR() {
  try {
    const res = await fetch(SOURCES.wwr, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text());
    return items.map(i => ({ ...i, source: "WeWorkRemotely", country: "remote" }));
  } catch (e) {
    console.error(`[WWR] falló: ${e.message}`);
    return [];
  }
}

// ---- Jobicy API (JSON, feed de 7 días, sin token) ----
export async function fetchJobicy() {
  try {
    const data = await jsonGet(SOURCES.jobicy);
    return (data.jobs || []).map(j => ({
      source: "Jobicy",
      url: j.url,
      title: j.jobTitle || "",
      date: new Date(j.pubDate).getTime(),
      country: j.jobGeo || "remote",
      snippet: stripHtml(j.jobExcerpt || j.jobDescription),
      companyName: j.companyName || "",
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      salaryPeriod: j.salaryPeriod || "",
      salaryCurrency: j.salaryCurrency || "USD",
    })).filter(j => j.title && !Number.isNaN(j.date));
  } catch (e) {
    console.error(`[Jobicy] falló: ${e.message}`);
    return [];
  }
}

// ---- Himalayas JSON API (pública, sin clave; paginación por cursor) ----
// Seguimos hasta 4 páginas (~80 ofertas) para cubrir la ventana de 24h.
export async function fetchHimalayas() {
  const jobs = [];
  let cursor = "";
  try {
    for (let page = 0; page < 4; page++) {
      const url = SOURCES.himalayas + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const data = await jsonGet(url);
      for (const j of data.jobs || []) {
        // Los sueldos vienen con período (hourly/yearly); lo dejamos legible
        let pay = "no listado";
        if (j.minSalary || j.maxSalary) {
          const cur = j.currency || "USD";
          pay = `${cur} $${j.minSalary ?? "?"}-$${j.maxSalary ?? "?"}/${j.salaryPeriod || "por período"}`;
        }
        jobs.push({
          source: "Himalayas",
          url: j.applicationLink || j.guid,
          title: j.title || "",
          date: new Date(j.pubDate).getTime(),
          country: (j.locationRestrictions || []).join(", ") || "worldwide",
          snippet: stripHtml(j.excerpt || j.description),
          companyName: j.companyName || "",
          pay,
        });
      }
      cursor = data.nextCursor || "";
      if (!cursor) break;
    }
  } catch (e) {
    console.error(`[Himalayas] falló (parcial): ${e.message}`);
  }
  return jobs;
}

// Adjunta salarios legibles a Remotive/RemoteOK cuando el texto los menciona.
export function injectRate(j) {
  const rate = detectHourlyRate(`${j.title} ${j.snippet}`);
  return { ...j, rate };
}
