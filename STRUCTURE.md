# STRUCTURE.md — Estructura del proyecto

```
/
├── README.md              # Portada + servicios + contacto
├── PERFIL.md              # Perfil freelance Venezuela (skills, tarifas, cobro)
├── STRUCTURE.md           # Este archivo
├── AI_CONTEXT.md          # Contexto para IA / MCP job-hunter
├── AGENTS.md              # Reglas generales para agentes
├── opencode.json          # Config Opencode (apunta a .opencode/AGENTS.md)
├── .opencode/
│   └── AGENTS.md          # Agente exclusivo Muse Spark filtrador
├── .github/
│   └── workflows/         # (futuro) daily-job-alert.yml
└── src/                   # (futuro) demos: web-svelte/ + kotlin-app/
    ├── web-svelte/        # Demo 1 landing
    └── kotlin-app/        # Demo 2 app notas
```

## Convenciones
- Docs raíz en `.md` español simple.
- Código futuro en `src/<demo>/` con su propio README.
- Archivos < 500 líneas, comentarios en español.
- No commitear secrets (`.env`, keys MCP, tokens Upwork).
