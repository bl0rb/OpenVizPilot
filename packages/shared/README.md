# @openvizpilot/shared

Der Vertrag zwischen Middleware und Extension. Reines TypeScript ohne Build-Schritt: `package.json` zeigt direkt auf `src/index.ts`, Server (tsup) und Extension (Vite) bündeln die Quelle mit. Einzige Laufzeitabhängigkeit ist zod. `npm run build` ist hier nur ein Typecheck.

## Module

| Datei | Inhalt |
|---|---|
| `src/schemas.ts` | Chat-Request und Nachrichten (`chatRequestSchema`, `chatMessageSchema`, `toolCallSchema`) samt Obergrenzen (`MAX_MESSAGES`, `MAX_CONTEXT_CHARS`, `MAX_TOOL_CALLS_PER_TURN`, …) |
| `src/sse-protocol.ts` | SSE-Ereignisse von `POST /api/chat`: `delta`, `tool_calls`, `done`, `error`, `ping` |
| `src/tools.ts` | Dashboard-Tools: Argument-Schemas (`toolArgSchemas`), Definitionen für das LLM (`toolDefinitions`), `lookup_metric` |
| `src/i18n.ts` | UI-Texte für `de` und `en`, `t(...)` |
| `src/slash-commands.ts`, `src/playbooks.ts` | Slash-Befehle (`DEFAULT_SLASH_COMMANDS`) und Starter-Fragen je Dashboard |
| `src/suggestions.ts` | Vorschlagsblock der Antwort: Anschlussfragen und Dashboard-Aktionen |
| `src/auth.ts`, `src/models.ts`, `src/prefs.ts`, `src/dashboards.ts`, `src/metrics.ts`, `src/usage.ts` | Schemas für Anmeldung, Modell-Katalog, Präferenzen, Dashboard-Zuordnung, Kennzahlenkatalog, Nutzungszahlen |
| `src/markdown.ts` | Markdown-Helfer für Antworten und Export |
| `src/trex.ts` | `.trex`-Manifest (Admin-Download und `build:trex`), `EXTENSION_VERSION` |

Alles wird über `src/index.ts` exportiert. Tests: `test/`.
