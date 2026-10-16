# STRUCTURE.md — Estructura del proyecto

```
/
├── README.md              # Portada + servicios móvil+web + contacto
├── PERFIL.md              # Perfil freelance VE: RN/Expo/Next/React/Kotlin, tarifas, cobro
├── STRUCTURE.md           # Este archivo
├── AI_CONTEXT.md          # Contexto para IA / MCP job-hunter
├── AGENTS.md              # Reglas generales para agentes
├── opencode.json          # Config Opencode + MCP (Upwork oficial + local)
├── .opencode/
│   └── AGENTS.md          # Agente exclusivo Muse Spark filtrador móvil+web
├── .github/
│   └── workflows/         # (futuro) daily-job-alert.yml — solo si lo pides
└── src/                   # (futuro) demos: corren con 1 comando
    ├── web-next/          # Demo 1: landing Next.js (npm run dev)
    └── app-expo/          # Demo 2: app Expo React Native (npx expo start)
```

## Convenciones
- Docs raíz en `.md` español simple.
- Código futuro en `src/<demo>/` con su propio README.
- Archivos < 500 líneas, comentarios en español.
- No commitear secrets (`.env`, keys MCP, tokens Upwork). Usar secrets GH.
- Prioridad: demos cortas móvil+web que consigan clientes.
