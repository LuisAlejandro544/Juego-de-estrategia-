#!/usr/bin/env node
// job-scout.mjs — Orquestador del scout de empleo (v3).
// Combina la web (9 llamadas sobre 7 plazas: Remotive feed+búsqueda, RemoteOK,
// WWR feeds programming+todas, Jobicy, Himalayas feed+búsqueda, Arbeitnow)
// y MCP (himalayas; upwork opcional), filtra por keywords móvil + frescura < 24h
// y publica issues "[job] ..." (regla 5). Sin notificaciones externas: el canal
// de avisos es GitHub (issues + $GITHUB_STEP_SUMMARY del run).
//
// Modos:
//   normal        → valida REPO/GH_TOKEN, crea issues con gh api
//   SCOUT_DRY_RUN=1 → imprime candidatas en stdout, no toca GitHub ni gh

import fs from "node:fs";
import {
  FRESH_MS, dedupeKey, matchesKeywords, detectHourlyRate, SOURCE_STATUS,
} from "./scout/config.mjs";
import {
  fetchRemotive, fetchRemotiveSearch, fetchRemoteOK, fetchWWR, fetchWwrAll,
  fetchJobicy, fetchHimalayas, fetchHimalayasSearch, fetchArbeitnow, injectRate,
} from "./scout/sources-api.mjs";
import { fetchMcpJobs, fetchUpworkMcp } from "./scout/sources-mcp.mjs";
import { publish } from "./scout/report.mjs";

const DRY_RUN = process.env.SCOUT_DRY_RUN === "1";
const REPO = process.env.REPO || "";
const GH_TOKEN = process.env.GH_TOKEN || "";

if (!DRY_RUN && (!REPO || !GH_TOKEN)) {
  console.error("Faltan REPO o GH_TOKEN (o define SCOUT_DRY_RUN=1 para prueba sin GitHub)");
  process.exit(1);
}

const now = Date.now();

// Keywords "driver" para preguntarle al MCP y a las APIs de búsqueda server-side.
// Se combinan en pocas llamadas para no saturar los servidores remotos.
const MCP_KEYWORD = "react native";
const SEARCH_QUERIES = ["react native", "kotlin"];

// Escribe la tabla de estado por fuente en la $GITHUB_STEP_SUMMARY del run,
// para detectar de un vistazo "esta fuente lleva N corridas fallando".
function writeSummary({ brute, fresh, created }) {
  const lines = [
    "## 🛰️ Job Scout — alertas de empleo móvil (<24 h)",
    "",
    "| Fuente | Estado | Ofertas brutas |",
    "|---|---|---|",
  ];
  for (const [name, st] of SOURCE_STATUS) {
    const estado = st.ok ? (st.nota ? `✅ ${st.nota}` : "✅") : `❌ ${st.error}`;
    lines.push(`| ${name} | ${estado} | ${st.n} |`);
  }
  lines.push(
    "",
    `- **Ofertas brutas (todas las fuentes):** ${brute}`,
    `- **Candidatas (<24 h + keywords móvil):** ${fresh}`,
    `- **Issues creados:** ${created === null ? "(dry-run: nada escrito)" : created}`,
  );
  const md = `${lines.join("\n")}\n`;
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

console.log("Scout v3 juntando fuentes (web + MCP)...");
const [remotive, remoteok, wwr, wwrAll, jobicy, himalayas, himalayaSearch, arbeitnow, mcpJobs] = await Promise.all([
  fetchRemotive(),
  fetchRemoteOK(),
  fetchWWR(),
  fetchWwrAll(),
  fetchJobicy(),
  fetchHimalayas(),
  fetchHimalayasSearch(SEARCH_QUERIES),
  fetchArbeitnow(),
  fetchMcpJobs(MCP_KEYWORD),
]);
const upworkJobs = await fetchUpworkMcp(MCP_KEYWORD); // opcional; requiere credenciales
// Remotive limita a 2 req/min: la búsqueda server-side va SECUENCIAL tras el feed.
const remotiveSearch = await fetchRemotiveSearch(MCP_KEYWORD);

// Todas las fuentes normalizadas + tasa horaria detectada en el texto
const all = [
  ...remotive, ...remotiveSearch, ...remoteok, ...wwr, ...wwrAll,
  ...jobicy, ...himalayas, ...himalayaSearch, ...arbeitnow, ...mcpJobs, ...upworkJobs,
].map(j => ({ ...injectRate(j), rate: j.rate ?? detectHourlyRate(`${j.title} ${j.snippet}`) }));

console.log(`Total bruto: ${all.length} ofertas de ${new Set(all.map(j => j.source)).size} fuentes`);

// Filtro: <24h (o edad no informada por el MCP) + keywords móviles
const fresh = all
  .filter(j => !Number.isNaN(j.date) ? now - j.date < FRESH_MS : j.dateUnknown)
  .filter(j => matchesKeywords(j.title, j.snippet).ok)
  // Dedupe entre fuentes por título normalizado
  .filter((j, i, arr) => arr.findIndex(o => dedupeKey(o.title) === dedupeKey(j.title)) === i);

console.log(`Frescas (<24h, keywords móvil): ${fresh.length}`);

const created = fresh.length === 0
  ? 0
  : await publish(REPO, fresh, { dryRun: DRY_RUN });

writeSummary({ brute: all.length, fresh: fresh.length, created: DRY_RUN ? null : created });

if (fresh.length === 0) {
  console.log("Sin ofertas móviles nuevas hoy. No se publica issue.");
  process.exit(0);
}
console.log(DRY_RUN ? "Dry-run completo: nada escrito." : `Listo: ${created} issues creados de ${fresh.length} candidatas.`);
