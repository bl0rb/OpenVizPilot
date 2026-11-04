# @openvizpilot/server

Die Middleware: Hono auf Node 24. Sie fügt System-Prompt und Tool-Definitionen ein, streamt die Antwort des OpenAI-kompatiblen LLM-Endpunkts per SSE an die Extension und verwaltet Anmeldung, Freigaben und Admin-Einstellungen. Sie hat keine Tableau-Identität und loggt nur Metadaten. Aufbau und Ablauf: [docs/architecture.md](../../docs/architecture.md).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev -w @openvizpilot/server` | `tsx watch src/index.ts` (Port 3000) |
| `npm run build -w @openvizpilot/server` | Bündelt mit tsup samt Abhängigkeiten nach `dist/index.js` |
| `npm run start -w @openvizpilot/server` | Startet den Build |
| `npm run typecheck -w @openvizpilot/server` | `tsc --noEmit` |

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/index.ts`, `src/app.ts` | Start und Zusammenbau: Speicher, Anmeldung, Freigaben, Routen, Admin-UI, Statik |
| `src/env.ts` | Konfiguration (`OVP_*`, zod), alte Namen über `LEGACY_ENV_NAMES` |
| `src/routes/` | `chat` (SSE), `models`, `desktop`, `commands`, `metrics`, `dashboards`, `stats`, `admin`, `auth`, `health` |
| `src/llm/` | OpenAI-Client, Stream-Verarbeitung, Zusammensetzen der Tool-Calls, Scope-Guard |
| `src/system-prompt.ts` | System-Prompt und Modus-Abschnitte |
| `src/memory/` | Speicher: Postgres (`OVP_DATABASE_URL`) oder SQLite (`OVP_DATABASE_PATH`) |
| `src/auth-state.ts`, `src/admin-auth.ts`, `src/user-access.ts` | Anmeldemodus, Admin-Konto, Freigaben je Person |
| `src/admin-page.ts`, `src/admin-font.ts` | Admin-UI unter `/admin` (Template-String, Vanilla-JS, eingebettete Inter-Schrift) |
| `src/logger.ts` | Metadaten-Logger |
| `scripts/mock-litellm.mjs` | Mock-LLM für `npm run dev:demo` (Port 4010) |
| `scripts/claude-code-llm.mjs` | LLM-Brücke zur lokal angemeldeten Claude-Code-CLI für `npm run dev:claude` (Port 4020) |
| `scripts/gen-admin-font.mjs` | Erzeugt `src/admin-font.ts` aus `@fontsource-variable/inter` |

Enterprise-Funktionen kommen aus `@openvizpilot/ee/server`. Tests: `test/`.
