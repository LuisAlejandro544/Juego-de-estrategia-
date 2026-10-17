// sources-api.mjs — Fuente API/RSS públicas de la web (sin tokens, sin MCP).
// Cada función devuelve [{source,url,title,date,country,verified,pay,snippet}]
// y captura sus propios errores para no tumbar al resto del scout.

import {
  SOURCES, HIMALAYAS_API_KEY, UA, stripHtml, detectHourlyRate,
  markOk, markFail,
} from "./config.mjs";

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
// Mapeo compartido entre el feed general y la búsqueda server-side.
const mapRemotive = jobs => jobs.map(j => ({
  source: "Remotive",
  url: j.url,
  title: j.title,
  date: new Date(j.publication_date).getTime(),
  country: j.candidate_required_location || "remote",
  snippet: stripHtml(j.description),
  companyName: j.company_name || "",
}));

export async function fetchRemotive() {
  try {
    const data = await jsonGet(SOURCES.remotive);
    const jobs = mapRemotive(data.jobs || []);
    markOk("Remotive (feed)", jobs.length);
    return jobs;
  } catch (e) {
    markFail("Remotive (feed)", e.message);
    console.error(`[Remotive] falló: ${e.message}`);
    return [];
  }
}

// ---- Remotive búsqueda server-side (máx 2 req/min: 1 sola llamada extra) ----
export async function fetchRemotiveSearch(keyword) {
  try {
    const data = await jsonGet(SOURCES.remotiveSearch + encodeURIComponent(keyword));
    const jobs = mapRemotive(data.jobs || []);
    markOk("Remotive (búsqueda)", jobs.length, `q="${keyword}"`);
    return jobs;
  } catch (e) {
    markFail("Remotive (búsqueda)", e.message);
    console.error(`[Remotive search] falló: ${e.message}`);
    return [];
  }
}

// ---- RemoteOK API ----
// Devuelve un array cuyo primer elemento es un aviso legal; se salta.
export async function fetchRemoteOK() {
  try {
    const data = await jsonGet(SOURCES.remoteok);
    const jobs = (Array.isArray(data) ? data.slice(1) : [])
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
    markOk("RemoteOK", jobs.length);
    return jobs;
  } catch (e) {
    markFail("RemoteOK", e.message);
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

// ---- WeWorkRemotely (mismo formato RSS para sus 2 feeds) ----
async function fetchWwrFeed(feedUrl, label) {
  try {
    const res = await fetch(feedUrl, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRss(await res.text()).map(i => ({ ...i, source: label, country: "remote" }));
    markOk(label, jobs.length);
    return jobs;
  } catch (e) {
    markFail(label, e.message);
    console.error(`[${label}] falló: ${e.message}`);
    return [];
  }
}

// Feed de programación (el más alineado con las keywords móviles)
export const fetchWWR = () => fetchWwrFeed(SOURCES.wwr, "WWR (programming)");
// Feed "todas las categorías": captura la sección mobile-app-mdev y otras técnicas
export const fetchWwrAll = () => fetchWwrFeed(SOURCES.wwrAll, "WWR (todas)");

// ---- Jobicy API (JSON, feed de 7 días, sin token) ----
export async function fetchJobicy() {
  try {
    const data = await jsonGet(SOURCES.jobicy);
    const jobs = (data.jobs || []).map(j => ({
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
    markOk("Jobicy", jobs.length);
    return jobs;
  } catch (e) {
    markFail("Jobicy", e.message);
    console.error(`[Jobicy] falló: ${e.message}`);
    return [];
  }
}

// ---- Himalayas JSON API (pública, sin clave; paginación por cursor) ----
// Seguimos hasta 4 páginas (~80 ofertas) para cubrir la ventana de 24h.
export async function fetchHimalayas() {
  const jobs = [];
  let cursor = "";
  let falloParcial = false;
  try {
    for (let page = 0; page < 4; page++) {
      const url = SOURCES.himalayas + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const data = await jsonGet(url);
      for (const j of data.jobs || []) {
        jobs.push({
          source: "Himalayas",
          ...mapHimalayasJob(j),
        });
      }
      cursor = data.nextCursor || "";
      if (!cursor) break;
    }
  } catch (e) {
    falloParcial = true;
    markFail("Himalayas (feed)", `parcial: ${e.message}`, jobs.length);
    console.error(`[Himalayas] falló (parcial): ${e.message}`);
  }
  if (!falloParcial) markOk("Himalayas (feed)", jobs.length);
  return jobs;
}

// Mapeo compartido entre el feed general y la búsqueda server-side de Himalayas.
// Ojo: su API devuelve pubDate en segundos epoch, no en ms (toleramos ISO por si cambia).
function mapHimalayasJob(j) {
  let pay = "no listado";
  if (j.minSalary || j.maxSalary) {
    const cur = j.currency || "USD";
    pay = `${cur} $${j.minSalary ?? "?"}-$${j.maxSalary ?? "?"}/${j.salaryPeriod || "por período"}`;
  }
  return {
    url: j.applicationLink || j.guid,
    title: j.title || "",
    date: typeof j.pubDate === "number" ? j.pubDate * 1000 : new Date(j.pubDate).getTime(),
    country: (j.locationRestrictions || []).join(", ") || "worldwide",
    snippet: stripHtml(j.excerpt || j.description),
    companyName: j.companyName || "",
    pay,
  };
}

// ---- Himalayas búsqueda server-side (reemplaza bajar 4 páginas del feed) ----
// Un fetch por keyword; ordena reciente y devuelve ~20 por query.
export async function fetchHimalayasSearch(queries) {
  const jobs = [];
  let fallos = 0;
  for (const q of queries) {
    try {
      const data = await jsonGet(SOURCES.himalayasSearch + encodeURIComponent(q));
      const mapped = (data.jobs || []).map(j => ({ source: "Himalayas (búsqueda)", ...mapHimalayasJob(j) }))
        .filter(j => j.title && !Number.isNaN(j.date));
      jobs.push(...mapped);
      console.log(`[Himalayas search] "${q}": ${mapped.length} ofertas`);
    } catch (e) {
      fallos++;
      console.error(`[Himalayas search] "${q}" falló: ${e.message}`);
    }
  }
  const queriesTxt = queries.map(q => `"${q}"`).join(", ");
  if (fallos === queries.length && jobs.length === 0) markFail("Himalayas (búsqueda)", `todas las queries fallaron (${queriesTxt})`);
  else markOk("Himalayas (búsqueda)", jobs.length, `q=${queriesTxt}`);
  return jobs;
}

// ---- Arbeitnow API (JSON público, sin key; remoto + Europa) ----
// Devuelve 300 ofertas con created_at en segundos epoch y flag "remote".
export async function fetchArbeitnow() {
  try {
    const data = await jsonGet(SOURCES.arbeitnow);
    const jobs = (data.data || [])
      .filter(j => j.remote) // solo remotos: el tablero es fuerte en Europa local
      .map(j => ({
        source: "Arbeitnow",
        url: j.url,
        title: j.title || "",
        date: j.created_at ? j.created_at * 1000 : NaN,
        country: j.location || "remote",
        snippet: stripHtml(j.description),
        companyName: j.company_name || "",
      }))
      .filter(j => j.title && j.url && !Number.isNaN(j.date));
    markOk("Arbeitnow", jobs.length);
    return jobs;
  } catch (e) {
    markFail("Arbeitnow", e.message);
    console.error(`[Arbeitnow] falló: ${e.message}`);
    return [];
  }
}

// Adjunta salarios legibles a Remotive/RemoteOK cuando el texto los menciona.
export function injectRate(j) {
  const rate = detectHourlyRate(`${j.title} ${j.snippet}`);
  return { ...j, rate };
}
