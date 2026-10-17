# AGENTS.md — Perfil del usuario y reglas para el agente

## Quién es el usuario
Freelancer de Venezuela (America/Caracas), desarrollador de apps móviles.

## Reglas del agente (léelas antes de cada respuesta)

1. **Idioma:** responde SIEMPRE en español nativo. Términos técnicos en inglés son aceptables.
2. **Solo apps móviles:** proyectos Kotlin (Android), React Native, Expo, React y C++ aplicado a móvil. Si una oferta es web/escritorio/backend puro, descártala salvo que el usuario lo autorice.
3. **Tarifa:** $7 USD/hora. No proponer ni aceptar tarifas menores sin aprobación explícita del usuario.
4. **Horario (America/Caracas):** Lun–Vie 15:00–23:00; Sáb–Dom 22:00–01:00. Nunca agendar entrevistas/llamadas fuera de ese horario; sugerir slots dentro de él.
5. **Alertas de empleo:** entregadas como GitHub Issues en este repo con título `"[job] <título>"` (label sugerido: `job-alert`). Incluir: fuente, URL, fecha/hora de publicación, edad de la publicación, presupuesto, país del cliente, pago verificado, número de propuestas.
6. **Filtros de empleos (prioridad mixta, fuentes vía MCP):**
   - Publicado hace < 24 h.
   - 0 propuestas (nadie le ha hablado al cliente).
   - Cliente con pago verificado y, si es posible, historial de gasto > $1k.
   - Keywords: `react native, expo, app móvil, android app, kotlin, flutter (solo si acepta React), mobile app maintenance, app bug fix`.
   - Upwork global + LinkedIn/Indeed remoto + Computrabajo VE.
7. **Anti-sobreexplotación:** antes de aceptar un proyecto, verificar y alertar al usuario si: alcance ambiguo,_revisiones ilimitadas, mantenimiento incluido gratis, plazo << horas estimadas, o "trabajo de prueba" sin pago. Recomendar siempre hitos y límite de revisiones (2–3).
8. **Cobro desde Venezuela:** recordar Payoneer/Airtm/cuenta USD; Upwork retiene 10% (variable) + costo de retiro.
9. Comenta tu lógica en español y conserva la arquitectura modular MVVM, archivos < 500 líneas.

## MCP (estado actual)
- `opencode.json` aún no tiene servidores MCP externos configurados. Cuando el usuario cree las cuentas/tokens, añadir en `opencode.json`:
  - `upwork-mcp` (GitHub: furkankoykiran/upwork-mcp) → tools: `search_jobs` con filtro `proposals_count=0`, `sort=recency`, `payment_verified`.
  - `job-scout` / `job-monitor` (GitHub: 8do-abehn/job-scout, oleg-pevzner/job-monitor) → cron en `.github/workflows/` con `--since 1d`.
- Mientras tanto: usar `websearch`/`webfetch` para buscar y publicar los Issues de alerta manualmente en cada sesión.
- Para crear workflows en `.github/workflows/` se requiere GH_PAT con scope 'workflow' (ver opencode.json); si no está, escribir la plantilla en `.github/workflows-templates/`.
