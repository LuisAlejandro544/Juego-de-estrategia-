#!/usr/bin/env node
// job-scout.mjs — Scout de empleo para AGENTS.md
// Busca ofertas móviles (RN/Expo/Kotlin/Flutter sin firmar) publicadas < 24h,
// las filtra y publica GitHub Issues con formato "[job] <título>".
// Reglas: español nativo, hitos + límite de revisiones siempre sugeridos.

import { execFileSync } from "node:child_process";

const REPO = process.env.REPO || "";
const GH_TOKEN = process.env.GH_TOKEN || "";
if (!REPO || !GH_TOKEN) {
  console.error("Faltan REPO o GH_TOKEN");
  process.exit(1);
}

// Ventana de frescura: 24h en segundos
const FRESH_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

// Fuentes RSS/API públicas remotas (sin token, sin MCP todavía):
// - Remotive API: traemos un lote amplio y filtramos por keywords localmente
//   (su filtro por categoría es poco fiable, devuelve ofertas no-móviles).
// - RemoteOK API: JSON con ofertas frescas, campo date con epoch.
// - WeWorkRemotely RSS de programación.
const REMOTIVE_URL = "https://remotive.com/api/remote-jobs?limit=100";
const REMOTEOK_URL = "https://remoteok.com/api";
const WWR_URL = "https://weworkremotely.com/categories/remote-programming-jobs.rss";

// Keywords de la regla 6 de AGENTS.md
const KW = [
  "react native", "expo", "kotlin", "android app", "android developer",
  "mobile app", "app móvil", "aplicación móvil", "flutter", "ios app",
];

// Pay que aceptamos ver en el anuncio (nunca menor a $7/h según regla 3)
const MIN_RATE = 7;

function gh(apiPath, method, body) {
  const args = ["api", apiPath];
  if (method) args.push("-X", method);
  if (body) {
    args.push("-f", `title=${body.title}`);
    args.push("-f", `body=${body.body}`);
    // gh api para arrays usa la sintaxis labels[]=valor
    if (body.labels) {
      for (const l of body.labels.split(",")) args.push("-f", `labels[]=${l.trim()}`);
    }
  }
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

function dedupeKey(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
}

// Cargar issues ya alertados para no duplicar
function existingKeys() {
  try {
    const out = JSON.parse(
      execFileSync("gh", [
        "api", `repos/${REPO}/issues?state=all&per_page=100&creator=${(REPO.split("/")[0])}`,
      ], { encoding: "utf8" })
    );
    return new Set(out.map(i => dedupeKey(i.title)));
  } catch {
    return new Set();
  }
}

function toIssue(job) {
  const ageH = Math.round((now - job.date) / 3600000);
  const flags = [];
  if (ageH > 24) flags.push("⚠️ Publicada hace más de 24h");
  if (job.probation) flags.push("⛔ Posible 'trabajo de prueba' sin pago");
  if (job.unpaidMaint) flags.push("⚠️ Mantenimiento incluido gratis");

  const body = [
    `**Fuente:** ${job.source}`,
    `**URL:** ${job.url}`,
    `**Fecha/hora de publicación:** ${new Date(job.date).toISOString()} (hace ~${ageH}h)`,
    `**Country del cliente:** ${job.country || "desconocido"}`,
    `**Pago verificado:** ${job.verified ? "sí" : "no confirmado"}`,
    `**Presupuesto/proposición:** ${job.pay || "no listado"}`,
    `**Número de propuestas:** ${job.proposals ?? "n/d"}`,
    "",
    "**Título original:**",
    `> ${job.title}`,
    "",
    "**Resumen:**",
    job.snippet || "",
    "",
    "---",
    "⚡ *Checklist antes de responder (regla 7):* verificar alcance, límite de revisiones (2–3), hitos por entrega, y rechazar revisiones ilimitadas/mantenimiento gratis.",
  ].join("\n");

  return { title: `[job] ${job.title}`.slice(0, 250), body, labels: "job-alert" };
}

// Etiqueta job-alert: crearla si no existe para que el primer issue no falle
async function ensureLabel() {
  try {
    execFileSync("gh", ["api", `repos/${REPO}/labels/job-alert`], { encoding: "utf8" });
  } catch {
    execFileSync("gh", ["api", `repos/${REPO}/labels`, "-X", "POST", "-f", "name=job-alert", "-f", "color=0E8A16", "-f", "description=Alertas de empleo móvil <24h"], { encoding: "utf8" });
  }
}

// ---- Fetch Remotive API (JSON, tiene fechas y descripción) ----
async function fetchRemotive() {
  const res = await fetch(REMOTIVE_URL, { headers: { "User-Agent": "job-scout/1.0" } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.jobs || []).map(j => ({
    source: "Remotive",
    url: j.url,
    title: j.title,
    date: new Date(j.publication_date).getTime(),
    country: j.candidate_required_location,
    verified: false,
    pay: j.salary || "no listado",
    snippet: (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 400),
  }));
}

// ---- Fetch RemoteOK API ----
// RemoteOK devuelve un array cuyo primer elemento es un aviso legal; se salta.
async function fetchRemoteOK() {
  try {
    const res = await fetch(REMOTEOK_URL, { headers: { "User-Agent": "job-scout/1.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data.slice(1) : []).map(j => ({
      source: "RemoteOK",
      url: `https://remoteok.com/remote-jobs/${j.slug}`,
      title: j.position || j.title || "",
      date: (j.date ? new Date(j.date).getTime() : NaN),
      country: j.location || "remote",
      verified: false,
      pay: (j.salary_min && j.salary_max) ? `$${j.salary_min}-$${j.salary_max}` : "no listado",
      snippet: (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 400),
    })).filter(j => j.title && !Number.isNaN(j.date));
  } catch {
    return [];
  }
}

// ---- Fetch WeWorkRemotely RSS ----
async function fetchWWR() {
  const res = await fetch(WWR_URL, { headers: { "User-Agent": "job-scout/1.0" } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const t = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
      return t ? t[1] : "";
    };
    const title = get("title").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = get("link").trim();
    const pub = get("pubDate").trim();
    const desc = get("description").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").slice(0, 400);
    const date = pub ? new Date(pub).getTime() : NaN;
    if (title && link && !Number.isNaN(date)) {
      items.push({ source: "WeWorkRemotely", url: link, title, date, snippet: desc });
    }
  }
  return items;
}

const seen = existingKeys();
const all = [...(await fetchRemotive()), ...(await fetchRemoteOK()), ...(await fetchWWR())];

// Filtro: keywords móvil + frescura < 24h
const fresh = all
  .filter(j => now - j.date < FRESH_MS)
  .filter(j => {
    const hay = (j.title + " " + j.snippet).toLowerCase();
    return KW.some(k => hay.includes(k));
  })
  .map(j => ({ ...j, verified: false, proposals: null, probation: /prueba|por procente|unpaid/i.test(j.snippet) }))
  .filter(j => !seen.has(dedupeKey(j.title)));

if (fresh.length === 0) {
  console.log("Sin ofertas móviles nuevas (<24h) hoy. No se publica issue.");
  process.exit(0);
}

await ensureLabel();

let created = 0;
for (const job of fresh.slice(0, 10)) {
  try {
    gh(`repos/${REPO}/issues`, "POST", toIssue(job));
    console.log(`✅ Issue creado: [job] ${job.title}`);
    created++;
  } catch (e) {
    console.error(`❌ No se pudo crear issue para '${job.title}':`, e.message);
  }
}
console.log(`Listo: ${created} issues creados de ${fresh.length} candidatas.`);
