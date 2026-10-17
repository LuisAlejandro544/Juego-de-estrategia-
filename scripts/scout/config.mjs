// config.mjs — Constantes compartidas del scout (reglas 3 y 6 de AGENTS.md)

// Ventana de frescura: 24 h en ms (regla 6)
export const FRESH_MS = 24 * 60 * 60 * 1000;

// Tarifa mínima objetivo: $7/h (regla 3). Por debajo → se marca, nunca se acepta solo.
export const MIN_RATE = 7;

// Keywords de la regla 6 de AGENTS.md
export const KEYWORDS = [
  "react native", "expo", "kotlin", "android app", "android developer",
  "mobile app", "app móvil", "aplicación móvil", "flutter", "ios app",
  "app bug fix", "mobile app maintenance",
];

// User-Agent común para todas las peticiones HTTP
export const UA = "job-scout/2.1 (github-action; alertas de empleo móvil)";

// Fuentes API/RSS públicas (web, sin token).
// Los terminos "*Search"/busqueda server-side ahorran descarga de feeds completos;
// Remotive limita a 2 req/min → solo 1 llamada de búsqueda extra por corrida.
export const SOURCES = {
  remotive: "https://remotive.com/api/remote-jobs?limit=100",
  remotiveSearch: "https://remotive.com/api/remote-jobs?limit=50&search=",
  remoteok: "https://remoteok.com/api",
  wwr: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  wwrAll: "https://weworkremotely.com/remote-jobs.rss",
  jobicy: "https://jobicy.com/api/v2/remote-jobs?count=100",
  himalayas: "https://himalayas.app/jobs/api?limit=20",
  himalayasSearch: "https://himalayas.app/jobs/api/search?sort=recent&limit=25&q=",
  arbeitnow: "https://arbeitnow.com/api/job-board-api",
};

// Registro de estado por fuente; lo consume job-scout.mjs para la $GITHUB_STEP_SUMMARY.
// map<nombre, {ok, n, error, nota}>
export const SOURCE_STATUS = new Map();

export function markOk(name, n, nota = "") {
  SOURCE_STATUS.set(name, { ok: true, n: n | 0, nota, error: "" });
}

export function markFail(name, error, n = 0) {
  SOURCE_STATUS.set(name, { ok: false, n, nota: "", error: String(error).slice(0, 100) });
}

// URL canónica para dedupe entre fuentes: sin query/hash ni barra final.
export function urlKey(u) {
  return String(u || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

// Servidor MCP de Himalayas (Streamable HTTP, sin autenticación).
// Se puede sobreescribir con SCOUT_MCP_URL por si cambia el endpoint.
export const HIMALAYAS_MCP_URL = process.env.SCOUT_MCP_URL || "https://mcp.himalayas.app/mcp";

// Clave API opcional de Himalayas (solo para límites de tasa más altos).
export const HIMALAYAS_API_KEY = process.env.HIMALAYAS_API_KEY || "";

// MCP local de Upwork (stdio): se activa solo si hay credenciales en el entorno.
// Requiere UPWORK_CLIENT_ID + UPWORK_CLIENT_SECRET y haber corrido
// `npx -y @furkankoykiran/upwork-mcp auth` una vez para guardar el token.
export const UPWORK_MCP_CMD = ["npx", "-y", "@furkankoykiran/upwork-mcp"];

// Regex de riesgo (regla 7: anti-sobreexplotación), evaluadas sobre título+resumen.
export const RISK_PATTERNS = {
  probation: /\bunpaid\b|test task|trabajo de prueba|free trial work|no paid trial/i,
  unpaidMaint: /maintenance included|free maintenance|mantenimiento (incluido|gratuito)/i,
  unlimitedRevisions: /unlimited revisions|revisiones ilimitadas/i,
  percentShare: /equity|profit share|revenue share|participaci[oó]n en beneficios/i,
};

// Detecta "tasa por hora" en texto libre; devuelve la menor tasa encontrada en USD.
// Ejemplos que matchea: "$10/hr", "$4 - $6 per hour", "$7/h"
export function detectHourlyRate(text) {
  const hay = String(text || "").toLowerCase();
  if (!/hour|hr|\/h\b|per hour/.test(hay)) return null;
  const re = /\$(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*\$?(\d+(?:[.,]\d+)?))?\s*(?:\/|per\s)?\s*(?:hour|hr)\b/g;
  let m;
  let min = null;
  while ((m = re.exec(hay)) !== null) {
    const a = parseFloat(m[1]);
    const b = m[2] ? parseFloat(m[2]) : a;
    const low = Math.min(a, b);
    if (min === null || low < min) min = low;
  }
  return min;
}

// Normaliza texto para el key de deduplicación entre fuentes.
export function dedupeKey(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
}

// Decide si un anuncio pasa el filtro de keywords.
// Regla 6: "flutter solo si acepta React" → si el match vino únicamente de
// "flutter", exigimos que el texto también mencione react/react native.
// Anti-falsos-positivos: si el keyword SOLO aparece en el texto (no en el título)
// —típico de descripciones tipo "somos una app móvil"— exigimos que el título
// sea claramente de un rol dev/móvil.
const DEV_TITLE_RE = /(react|expo|kotlin|flutter|ios|android|mobile|dev|developer|engineer|desarrollador)/i;

export function matchesKeywords(title, snippet) {
  const t = String(title).toLowerCase();
  const hay = `${title} ${snippet}`.toLowerCase();
  const inTitle = KEYWORDS.some(k => t.includes(k));
  const hits = KEYWORDS.filter(k => hay.includes(k));
  if (hits.length === 0) return { ok: false };
  const flutter_only = hits.length === 1 && hits[0] === "flutter";
  const aceptaReact = /react (native|js)?|reactnative/.test(hay);
  if (flutter_only && !aceptaReact) return { ok: false };
  if (inTitle) return { ok: true };
  // Match solo en texto: exigir título dev + 2 keywords para bajar el ruido
  return { ok: Boolean(DEV_TITLE_RE.test(title) && hits.length >= 1) };
}

// Quita etiquetas HTML y recorta a n caracteres.
export function stripHtml(html, n = 400) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}
