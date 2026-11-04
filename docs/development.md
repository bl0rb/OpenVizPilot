# Entwicklung

Bauen, testen, lokal starten und prüfen. Den Aufbau des Systems beschreibt [architecture.md](architecture.md), die Regeln für Änderungen [contributing.md](contributing.md).

## Voraussetzungen

- Node.js 24 (`.nvmrc`; `engines` verlangt ≥ 24, der Dev-Speicher nutzt das eingebaute `node:sqlite`) und npm.
- Optional: Docker (Image bauen, Compose), Helm 3 (Chart prüfen), Tableau Desktop (Test mit der echten Extensions API).

## Einrichten

```bash
npm install
cp .env.example .env   # OVP_LLM_BASE_URL, OVP_LLM_API_KEY, OVP_DEFAULT_MODEL setzen
```

Alle Einstellungen sind Umgebungsvariablen `OVP_*`; `.env.example` beschreibt jede einzelne. Das Schema mit Standardwerten steht in `packages/server/src/env.ts`. Ohne `OVP_DATABASE_URL` speichert die Middleware in SQLite unter `OVP_DATABASE_PATH` (Vorgabe in `.env.example`: `./data/memory.db`, gitignored).

## Starten

| Befehl | Was läuft |
|---|---|
| `npm run dev` | Middleware (:3000) und Extension (:5173), für Tableau Desktop |
| `npm run dev:mock` | Dasselbe mit Mock-Dashboard im Browser, ohne Tableau |
| `npm run dev:demo` | Wie `dev:mock`, dazu ein Mock-LLM (:4010); kein LLM-Endpunkt nötig |
| `npm run dev:demo:sso` | Wie `dev:demo`, dazu ein Mock-IdP (:4030) mit Auto-Login (Enterprise) |
| `npm run dev:claude` | Für Tableau Desktop; Antworten kommen über die lokal angemeldete Claude-Code-CLI (:4020) |
| `npm run dev:static-demo -w @openvizpilot/extension` | Nur die Extension im statischen Demo-Modus: vorgefertigte Antworten, keine Middleware, kein LLM |

Im Mock-Modus öffnest du http://localhost:5173. Mit `dev:demo` lösen Fragen mit „Filter“ oder „Revenue“ Tool-Calls im Mock-LLM aus. Die Launch-Konfigurationen `demo` und `static-demo` in `.claude/launch.json` starten diese Modi für die Vorschau.

Für `dev:demo:sso` gibt der Mock-IdP beim Start die passenden `.env`-Werte aus (`OVP_AUTH_MODE=oidc`, `OVP_OIDC_ISSUER`, …). Enterprise-Funktionen brauchen außerdem eine Lizenz, siehe [enterprise.md](enterprise.md#lizenzschlüssel).

## Mit Tableau Desktop testen

1. `npm run dev` starten.
2. In Tableau ein Dashboard öffnen, ein Objekt „Erweiterung“ auf das Dashboard ziehen und `packages/extension/public/openvizpilot.dev.trex` wählen. Dieses Manifest zeigt auf den Vite-Dev-Server; das Manifest aus der Admin-UI zeigt auf die Middleware, die die Extension nur in Produktion ausliefert.
3. Debuggen: Tableau Desktop mit `--remote-debugging-port=8696` starten und in Chrome http://localhost:8696 öffnen.

Das vollständige manuelle Drehbuch steht in [testing.md](testing.md).

## Tests und Prüfungen

```bash
npm run typecheck   # tsc --noEmit in allen Workspaces
npm test            # Vitest über alle Projekte (packages/*, ee)
npm run build       # shared → server (tsup) → extension (vite)
```

Tests liegen je Workspace in `test/*.test.ts` (`packages/shared/test`, `packages/server/test`, `packages/extension/test`, `ee/test`). Die Wurzel-`vitest.config.ts` fasst sie als Projekte zusammen. Gezielt laufen lassen:

```bash
npx vitest run packages/server/test/chat-route.test.ts   # eine Datei
npx vitest run packages/extension                        # ein Workspace
npx vitest packages/shared                               # Watch-Modus
npm run typecheck -w @openvizpilot/server                # ein Paket typprüfen
```

Die CI (`.github/workflows/pr-ci.yml`) führt zusätzlich `npm audit --audit-level=high` aus, baut das Docker-Image, startet es mit einem Smoke-Test und prüft das Helm-Chart mit `helm lint` und mehreren `helm template`-Varianten, auch solchen, die fehlschlagen müssen. Bei Änderungen an Chart oder Image diese Schritte lokal nachstellen:

```bash
helm lint charts/openvizpilot --set llm.baseUrl=http://litellm:4000 --set llm.apiKey=x --set app.defaultModel=m
docker build -t openvizpilot:dev .
```

## Core-Export prüfen (nur Enterprise-Repo)

```bash
scripts/core-export.sh /tmp/ovp-core
```

Exportiert den Baum wie für das öffentliche Repo, also ohne `ee/` und mit `ee-stub/` an seiner Stelle, und führt dort `npm ci`, Typecheck, Tests und Build aus. Nötig, wenn du Importe aus `@openvizpilot/ee/...` im Kern, `ee-stub/` oder Abhängigkeiten von `ee/` änderst. Die CI macht das bei jedem PR (`enterprise-core-export-check.yml`).

## Produktionsbuild

- **Image:** `Dockerfile` baut Server und Extension in einem Image. Der Server ist vollständig gebündelt, die Extension liegt unter `./public` und wird über `OVP_SERVE_STATIC_DIR` vom selben Origin ausgeliefert. Port 3000, Health-Check `GET /healthz`.
- **Kubernetes:** Helm-Chart `charts/openvizpilot`; Werte und Einrichtung in [admin-deployment.md](admin-deployment.md).
- **Einzelne VM:** `deploy/compose/compose.yaml` mit Postgres und optional Caddy als HTTPS-Proxy.
- **Statischer Demo-Build:** `npm run build:static-demo -w @openvizpilot/extension` schreibt `packages/extension/dist-demo/` samt `openvizpilot-demo.trex`; die Ziel-URL setzt `OVP_DEMO_URL`.

## Hilfsskripte

| Befehl | Zweck |
|---|---|
| `npm run build:trex -w @openvizpilot/extension -- --dev` | `.trex`-Manifest erzeugen (`--dev`, `--url <URL>`, `--demo`, `--out <Datei>`); dieselbe Vorlage nutzt der Admin-Download |
| `node packages/server/scripts/gen-admin-font.mjs` | Inter-Schrift der Admin-UI neu einbetten (`packages/server/src/admin-font.ts`) |
| `npm run sign-license -w @openvizpilot/ee -- keygen ./keys` | Lizenz-Schlüsselpaar erzeugen; außerdem `sign` und `verify` (nur Enterprise-Repo). `keys/` ist gitignored und darf nie committet werden |
| `npm run mock-oidc -w @openvizpilot/ee` | Mock-IdP allein starten (nur Enterprise-Repo) |

`packages/extension/scripts/gen-icon.mjs` ist historisch und wird nicht mehr ausgeführt: Das Icon stammt aus `docs/images/logo.svg`.
