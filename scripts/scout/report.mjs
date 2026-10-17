// report.mjs — Publica los resultados como GitHub Issues "[job] <título>".
// (regla 5 de AGENTS.md: fuente, URL, fecha, edad, pago, país, flag de riesgo)

import { execFileSync } from "node:child_process";
import { MIN_RATE, RISK_PATTERNS, dedupeKey, urlKey } from "./config.mjs";

function gh(apiPath, method, body) {
  const args = ["api", apiPath];
  if (method) args.push("-X", method);
  if (body) {
    args.push("-f", `title=${body.title}`);
    args.push("-f", `body=${body.body}`);
    if (body.labels) {
      for (const l of body.labels.split(",")) args.push("-f", `labels[]=${l.trim()}`);
    }
  }
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

// Claves ya alertadas (por label) para no duplicar. Cubre título normalizado Y
// URL canónica (los feeds a veces renombran un post: "Dev RN" → "Dev RN (m/f/d)"
// deja pasar si solo comparamos títulos, pero la URL es la misma).
function existingKeys(repo) {
  const titles = new Set();
  const urls = new Set();
  try {
    const out = JSON.parse(
      execFileSync("gh", ["api", `repos/${repo}/issues?state=all&per_page=100&labels=job-alert`], { encoding: "utf8" })
    );
    for (const i of out) {
      titles.add(dedupeKey(i.title.replace(/^\[job\]\s*/i, "")));
      urls.add(urlKey(primeraUrl(i.body || "")));
    }
  } catch {
    // sin API disponible: alertamos igual, el histórico solo evita duplicados
  }
  return { titles, urls };
}

// Primera URL del body del issue: siempre es la del empleo en toIssue().
function primeraUrl(body) {
  const m = /https?:\/\/\S+/.exec(body);
  return m ? m[0] : "";
}

// ¿Riesgos de sobreexplotación detectados en título+resumen?
function detectRisks(title, snippet) {
  const hay = `${title} ${snippet}`;
  const flags = {};
  for (const [key, re] of Object.entries(RISK_PATTERNS)) flags[key] = re.test(hay);
  return flags;
}

function toIssue(job, now) {
  const ageH = job.dateUnknown ? -1 : Math.max(0, Math.round((now - job.date) / 3600000));
  const risks = detectRisks(job.title, job.snippet);
  const flags = [];
  if (job.dateUnknown) flags.push("ℹ️ Edad de publicación no informada por la fuente MCP");
  else if (ageH > 24) flags.push("⚠️ Publicada hace más de 24h");
  if (job.rate !== null && job.rate !== undefined && job.rate < MIN_RATE)
    flags.push(`⚠️ Tasa detectada $${job.rate}/h < $${MIN_RATE}/h mínimo (${MIN_RATE})`);
  if (risks.probation) flags.push("⛔ Posible 'trabajo de prueba' sin pago");
  if (risks.unpaidMaint) flags.push("⚠️ Mantenimiento incluido gratis");
  if (risks.unlimitedRevisions) flags.push("⚠️ Revisiones ilimitadas");
  if (risks.percentShare) flags.push("⚠️ Propone equity/revenue share en lugar de dólares");

  const fecha = job.dateUnknown
    ? "no informada por la fuente (MCP)"
    : `${new Date(job.date).toISOString()} (hace ~${ageH}h)`;

  const body = [
    `**Fuente:** ${job.source}${job.companyName ? ` · ${job.companyName}` : ""}`,
    `**URL:** ${job.url}`,
    `**Fecha/hora de publicación:** ${fecha}`,
    `**País del cliente:** ${job.country || "desconocido"}`,
    `**Pago verificado:** ${job.verified ? "sí" : "no confirmado"}`,
    `**Presupuesto/tasa:** ${job.pay || "no listado"}`,
    `**Número de propuestas:** ${job.proposals ?? "n/d"}`,
    "",
    "**Título original:**",
    `> ${job.title}`,
    "",
    "**Resumen:**",
    job.snippet || "",
    flags.length ? `\n**Avisos:**\n${flags.map(f => `- ${f}`).join("\n")}` : "",
    "",
    "---",
    "⚡ *Checklist antes de responder (regla 7):* verificar alcance, límite de revisiones (2–3), hitos por entrega, y rechazar revisiones ilimitadas/mantenimiento gratis.",
  ].join("\n");

  return { title: `[job] ${job.title}`.slice(0, 250), body, labels: "job-alert" };
}

// Crea el label si no existe y publica hasta maxIssues issues; devuelve el total creado.
export async function publish(repo, jobs, { dryRun = false, maxIssues = 12 } = {}) {
  const now = Date.now();

  if (dryRun) {
    for (const j of jobs.slice(0, maxIssues)) {
      const ageH = Math.max(0, Math.round((now - j.date) / 3600000));
      console.log(`DRY - ${j.source} - ${j.title} (${ageH}h) - ${j.url}`);
    }
    return 0;
  }

  await ensureLabel(repo);
  const seen = existingKeys(repo);
  let created = 0;
  for (const job of jobs.slice(0, maxIssues)) {
    const clean = job.title.replace(/^\[job\]\s*/i, "");
    const yaAlertada = seen.titles.has(dedupeKey(clean)) || (job.url && seen.urls.has(urlKey(job.url)));
    if (yaAlertada) continue;
    try {
      gh(`repos/${repo}/issues`, "POST", toIssue(job, now));
      console.log(`Issue creado: [job] ${clean}`);
      created++;
    } catch (e) {
      console.error(`No se pudo crear issue para '${clean}':`, e.message);
    }
  }
  return created;
}

async function ensureLabel(repo) {
  try {
    execFileSync("gh", ["api", `repos/${repo}/labels/job-alert`], { encoding: "utf8" });
  } catch {
    execFileSync("gh", ["api", `repos/${repo}/labels`, "-X", "POST", "-f", "name=job-alert", "-f", "color=0E8A16", "-f", "description=Alertas de empleo móvil <24h"], { encoding: "utf8" });
  }
}
