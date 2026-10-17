#!/usr/bin/env node
// job-scout.mjs — Orquestador del scout de empleo (v2).
// Combina la web (5 fuentes API/RSS públicas) y MCP (himalayas; upwork opcional),
// filtra por keywords móvil + frescura < 24h y publica issues "[job] ..." (regla 5).
//
// Modos:
//   normal        → valida REPO/GH_TOKEN, crea issues con gh api
//   SCOUT_DRY_RUN=1 → imprime candidatas en stdout, no toca GitHub ni gh

import {
  FRESH_MS, dedupeKey, matchesKeywords, detectHourlyRate,
} from "./scout/config.mjs";
import {
  fetchRemotive, fetchRemoteOK, fetchWWR, fetchJobicy, fetchHimalayas, injectRate,
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

// Keywords "driver" para preguntarle al MCP por búsquedas específicas.
// Se combinan en una sola llamada para no saturar el servidor remoto.
const MCP_KEYWORD = "react native";

console.log("Scout v2 juntando fuentes (web + MCP)...");
const [remotive, remoteok, wwr, jobicy, himalayas, mcpJobs] = await Promise.all([
  fetchRemotive(),
  fetchRemoteOK(),
  fetchWWR(),
  fetchJobicy(),
  fetchHimalayas(),
  fetchMcpJobs(MCP_KEYWORD),
]);
const upworkJobs = await fetchUpworkMcp(MCP_KEYWORD); // opcional; requiere credenciales

// Todas las fuentes normalizadas + tasa horaria detectada en el texto
const all = [...remotive, ...remoteok, ...wwr, ...jobicy, ...himalayas, ...mcpJobs, ...upworkJobs]
  .map(j => ({ ...injectRate(j), rate: j.rate ?? detectHourlyRate(`${j.title} ${j.snippet}`) }));

console.log(`Total bruto: ${all.length} ofertas de ${new Set(all.map(j => j.source)).size} fuentes`);

// Filtro: <24h (o edad no informada por el MCP) + keywords móviles
const fresh = all
  .filter(j => !Number.isNaN(j.date) ? now - j.date < FRESH_MS : j.dateUnknown)
  .filter(j => matchesKeywords(j.title, j.snippet).ok)
  // Dedupe entre fuentes por título normalizado
  .filter((j, i, arr) => arr.findIndex(o => dedupeKey(o.title) === dedupeKey(j.title)) === i);

console.log(`Frescas (<24h, keywords móvil): ${fresh.length}`);
if (fresh.length === 0) {
  console.log("Sin ofertas móviles nuevas hoy. No se publica issue.");
  process.exit(0);
}

const created = await publish(REPO, fresh, { dryRun: DRY_RUN });
console.log(DRY_RUN ? "Dry-run completo: nada escrito." : `Listo: ${created} issues creados de ${fresh.length} candidatas.`);
