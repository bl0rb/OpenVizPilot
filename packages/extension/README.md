# @openvizpilot/extension

Die Tableau-Dashboard-Extension: Chat-UI auf Preact, gebaut mit Vite. Sie führt die Tool-Calls des LLM im Browser über die Tableau Extensions API aus, also in der Sitzung der angemeldeten Person. Aufbau und Ablauf: [docs/architecture.md](../../docs/architecture.md).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev -w @openvizpilot/extension` | Vite-Dev-Server (Port 5173) für Tableau Desktop mit `public/openvizpilot.dev.trex` |
| `npm run dev:mock -w @openvizpilot/extension` | Mit Mock-Dashboard im Browser |
| `npm run dev:static-demo -w @openvizpilot/extension` | Statischer Demo-Modus mit Mock-Dashboard: vorgefertigte Antworten, keine Middleware |
| `npm run build -w @openvizpilot/extension` | Produktionsbuild nach `dist/` |
| `npm run build:static-demo -w @openvizpilot/extension` | Demo-Build nach `dist-demo/` samt `openvizpilot-demo.trex` (Ziel-URL über `OVP_DEMO_URL`) |
| `npm run build:trex -w @openvizpilot/extension -- --dev` | `.trex`-Manifest erzeugen (`--dev`, `--url`, `--demo`, `--out`) |
| `npm run typecheck -w @openvizpilot/extension` | `tsc --noEmit` |

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/main.tsx` | Start: Tableau initialisieren (oder Mock), Sprache, Workbook-Formatierung übernehmen |
| `src/chat/` | Agent-Loop mit Rundenbudget je Modus, SSE-Client, Anmeldesitzung, Slash-Befehle, Feature-Abfrage |
| `src/tableau/` | Zugriff auf die Extensions API, Kontext-Snapshot, Dashboard-Aktionen, Dashboard-Zuordnung, Formatierung |
| `src/tools/` | `registry.ts` (Ausführung, Kürzung, nie werfen) und ein Executor je Tool in `executors/` |
| `src/ui/` | Komponenten (`App`, `MessageList`, `Composer`, `SettingsPanel`, …), Reducer, Styles |
| `src/mock/` | Mock-Dashboard für Entwicklung ohne Tableau |
| `src/demo/` | Statischer Demo-Modus: beantwortet alle `/api/*`-Aufrufe im Browser |
| `public/openvizpilot.dev.trex` | Manifest für den Dev-Server |
| `scripts/make-trex.ts` | Erzeugt `.trex`-Manifeste aus `@openvizpilot/shared` |

Enterprise-Teile (Login, Memory, MCP-Bestätigung, Tableau-Server-Tools, Watch) kommen aus `@openvizpilot/ee/extension`. Tests: `test/`.
