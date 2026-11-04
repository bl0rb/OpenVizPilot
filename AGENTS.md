# AGENTS.md: Leitfaden für KI-Agenten und Mitwirkende

OpenVizPilot ist ein source-available KI-Copilot für Tableau: eine **Dashboard-Extension mit Chat** (Vite + Preact), eine schlanke, zustandslose **Node.js-Middleware** (Hono, per tsup gebündelt) und ein gemeinsamer Vertrag (`packages/shared`, zod). Die Middleware spricht mit einem beliebigen OpenAI-kompatiblen LLM-Endpunkt (z. B. LiteLLM); das LLM fragt Dashboard-Daten per Tool-Calling ab, und **jeder Datenzugriff läuft in der Tableau-Sitzung des Betrachters**. Alles ist TypeScript (strict), npm-Workspaces, Node ≥ 24 (`.nvmrc`). Der Produktname wird in Texten immer **OpenVizPilot** geschrieben; Maschinennamen bleiben klein: Pakete `@openvizpilot/*`, Env-Variablen `OVP_*`, Image `ghcr.io/bl0rb/openvizpilot[-enterprise]`. Es gibt zwei Repos: **`bl0rb/OpenVizPilotEnterprise`** (privat, Vollprodukt mit echtem `ee/`, hier wird gearbeitet) und **`bl0rb/OpenVizPilot`** (öffentlich, Core-Export mit `ee-stub/` als `ee/`, dort nie direkt committen). Die Desktop-App ist ein eigenes Repo ([bl0rb/OpenVizPilotDesktop](https://github.com/bl0rb/OpenVizPilotDesktop)); hier liegt nur ihr Server-Endpunkt. Diese Datei geht per Core-Export auch ins öffentliche Repo: Pfade, die es nur im Enterprise-Repo gibt, sind markiert. Lies zuerst diese Datei, dann `docs/`.

## 1. Orientierung (5 Minuten)

| Lesen | Warum |
|---|---|
| `README.md` | Was das Produkt tut, Architektur, Pakete, Dev-Befehle, Editionen, Lizenz |
| `docs/architecture.md` | Workspaces, Weg einer Frage (Snapshot → `/api/chat` → SSE → Tools), Middleware-Aufbau, Naht Core/Enterprise, Sicherheitsgrenzen |
| `docs/development.md` | Einrichten, Dev-Modi, Tableau Desktop, Tests gezielt laufen lassen, Core-Export, Produktionsbuild, Hilfsskripte |
| `docs/contributing.md` | Regeln für Änderungen und Checklisten: Dashboard-Tool, Konfigurationsvariable, Enterprise-Funktion, UI-Text |
| `packages/<name>/README.md` | Befehle und Aufbau des jeweiligen Workspace |
| `docs/testing.md` | Automatische Tests und das manuelle E2E-Drehbuch (Middleware solo, Mock-Browser, Tableau Desktop, Tableau Server) |
| `docs/UI-SPEC.md` | Oberflächen, Farben, Typografie, Komponenten, Dark Mode |
| `docs/admin-deployment.md` | Betrieb: Helm/EKS, Docker Compose, Zugriffsschutz, Datenschutz, serverseitiger Datenzugriff, Watch |
| `docs/enterprise.md` | Enterprise Edition: SSO (Entra, Keycloak), Personalisierung, Lizenz, Aktivierung/Lease, Bezug des Images |
| `docs/mcp.md`, `docs/tableau-mcp.md` | MCP-Quellen im Chat bzw. der Tableau-MCP-Server für externe Agenten, jeweils mit Berechtigungsmodell |
| `docs/tableau-server.md`, `docs/tableau-server-setup.md` | Tableau-Server-Anbindung: Referenz (Sicherheitsmodell, Tools, Limits) und Einrichtung |
| `docs/desktop.md`, `docs/watch.md`, `docs/user-approvals.md` | Desktop-Endpunkt, Watch, Benutzerfreigaben |
| `docs/diagrams/` | Architektur, Datenzugriff, Lizenzzustände (HTML-Quelle + PNG/SVG) |
| `ee/README.md` | Modulkarte der Enterprise Edition und Lizenzformat (nur Enterprise-Repo; öffentlich ist `ee/` der Stub) |
| `ee-stub/README.md` | Wozu der Stub da ist (nur Enterprise-Repo) |
| `private/` | Release-Ablauf, nächste Schritte, ADRs, Machbarkeitsstudien (nur Enterprise-Repo, wird nie exportiert) |

## 2. Workspace-Karte

```text
packages/
  shared        Vertrag beider Seiten: zod-Schemas, SSE-Protokoll, Tool-Definitionen, i18n (de/en), Markdown, .trex-Vorlage
  server        Middleware (Hono): /api/chat (SSE), /api/models, /api/desktop, Admin-API + /admin, /healthz;
                llm/ (Client, Stream, Scope-Guard), memory/ (SQLite für Dev, Postgres für Betrieb), routes/
  extension     Dashboard-Extension (Vite + Preact): chat/ (Agent-Loop, SSE), tableau/ (Extensions API, Kontext-Snapshot,
                Aktionen), tools/ (Executor je Tool), ui/, mock/ (Mock-Dashboard), demo/ (statischer Demo-Modus)
ee/             Enterprise Edition (eigene, proprietäre Lizenz): server/src (Lizenz, OIDC, Personalisierung, MCP, Tableau Server,
                Watch, Desktop-Agent, Tableau-MCP, Telemetrie), extension/src, scripts/, test/
ee-stub/        No-op-Ersatz für ee/ im öffentlichen Repo (nur Enterprise-Repo; kein Workspace)
charts/openvizpilot/   Helm-Chart (EKS, CNPG-Postgres, Ingress, HPA/VPA)
deploy/compose/        Docker Compose + Caddy für eine einzelne VM
scripts/core-export.sh Core-Export ins öffentliche Repo (nur Enterprise-Repo)
Dockerfile             Ein Image: gebündelter Server + Extension-Statik (Same-Origin)
```

**Die Naht Core ↔ Enterprise ist hart.** Der Kern importiert Enterprise-Funktionen nur über `@openvizpilot/ee/server` bzw. das Extension-Pendant. Alles, was der Kern von dort importiert, muss auch `ee-stub/server/src/index.ts` bzw. `ee-stub/extension/src/index.ts` mit gleicher Form und lizenzfreiem No-op-Verhalten exportieren (keine Lizenz, 402 auf lizenzpflichtigen Routen, leere Speicher). Lizenzpflichtige Logik (Tabellen, Prompt-Bausteine, Schemas, UI) gehört nach `ee/`, nie nach `packages/`. Gemeinsame Abhängigkeiten von `ee/package.json` und `ee-stub/package.json` tragen dieselbe Versionsangabe; `scripts/core-export.sh` bricht sonst ab.

## 3. Goldene Regeln

### Datenisolation zuerst (geht vor Feature-Arbeit)

Kunden vertrauen OpenVizPilot ihre Tableau-Daten an, und das ganze Produkt beruht darauf, dass niemand etwas sieht, was Tableau ihm nicht zeigt. Ein Feature, das diese Grenze aufweicht, wird nicht gebaut, egal wie nützlich es ist.

- **Keine Tableau-Identität in der Middleware.** Kein Service-Account, kein PAT, kein „im Namen von“ einer anderen Person. Datenzugriffe laufen in der Extension (Viewer-Sitzung) oder serverseitig ausschließlich mit dem eigenen IdP-Token der angemeldeten Person.
- **Serverseitige Daten nur mit allen drei Schlüsseln:** Lizenz-Feature (`serverData`), Freigabe je Person durch den Admin und Einwilligung der Person. Fehlt einer, gibt es die Tools gar nicht.
- **Keine Inhalte in Logs.** `packages/server/src/logger.ts` loggt nur Metadaten (Modell, Dauer, Token, Fehlerklasse), nie Nachrichten, Kontext-Snapshots oder Tool-Ergebnisse. Die Middleware speichert keinen Chatverlauf und cacht keine Dashboard-Daten.
- **Dashboard-Änderungen nur auf Klick.** Das LLM schlägt Aktionen als Chips vor, ausgeführt wird erst nach Klick, mit sichtbarem technischem Detail. Ohne `actions`-Lizenz kennt das Modell die Aktionssyntax nicht, und die Extension verwirft Aktionslisten zusätzlich.
- **Lizenzprüfung serverseitig und vor der Ausführung.** Ein Feature-Gate nur in der UI zählt nicht.
- **Secrets bleiben serverseitig.** LLM-Key nur in der Middleware; im Admin-UI gespeicherte Secrets verschlüsselt (`ee/server/src/secrets.ts`, Schlüssel aus `OVP_SECRET_KEY`). Nie Schlüssel, Lizenz-Token oder `.pem`/`.b64url`-Dateien committen (`.gitignore` schließt sie aus; das öffentliche Repo bekommt alles, was hier versioniert ist).
- **Belege es.** Jede Änderung an Auth, Freigaben, Lizenz oder Datenzugriff kommt mit einem Test für den abgelehnten Fall (fehlende Lizenz, fehlende Freigabe, fremder Header). Der Smoke-Test in `pr-ci.yml` prüft z. B., dass ein gesetzter `x-tableau-user`-Header keine Freigabe umgeht.

1. **Kleinster vollständiger Diff.** Nur ändern, was die Aufgabe braucht: kein Umbenennen, Umformatieren oder Aufräumen nebenbei, keine neuen Abhängigkeiten oder Abstraktionen ohne Not. Vorhandene Muster und Helfer wiederverwenden.
2. **`shared` ist der Vertrag.** Was Server und Extension austauschen (Request/Response, SSE-Ereignisse, Tool-Argumente), ist ein zod-Schema in `packages/shared/src`. Ein neues Dashboard-Tool = Eintrag in `toolArgSchemas` und `toolDefinitions` (`packages/shared/src/tools.ts`) plus Executor in `packages/extension/src/tools/executors/` plus Tests; die vollständige Checkliste steht in `docs/contributing.md`. Tool-Executoren werfen nie; Fehler gehen als Text an das LLM zurück (`packages/extension/src/tools/registry.ts`).
3. **Konfiguration ist `OVP_*`.** Eine neue Env-Variable gehört in das zod-Schema in `packages/server/src/env.ts`, in `.env.example` (mit deutschem Kommentar), in `charts/openvizpilot` (`values.yaml`, `templates/deployment.yaml`, bei Secrets `templates/env-secret.yaml`) und, falls für Betreiber relevant, in die passende Doku. Alte Namen nur über `LEGACY_ENV_NAMES`.
4. **Zweisprachig.** Jeder sichtbare Text der Extension steht in `packages/shared/src/i18n.ts` für `de` und `en`. Doku unter `docs/` und Code-Kommentare sind Deutsch, `README.md` ist Englisch.
5. **Tests sind das Tor.** Jede Verhaltensänderung kommt mit Vitest-Tests im `test/`-Ordner des betroffenen Workspaces (`packages/*/test/`, `ee/test/`). Strikte TypeScript-Optionen (`tsconfig.base.json`, u. a. `noUncheckedIndexedAccess`) nicht lockern.
6. **Die Admin-UI hat keinen Build-Schritt.** `/admin` ist ein Template-String mit Vanilla-JS (`packages/server/src/admin-page.ts`, Enterprise-Teile in `ee/server/src/*/admin-ui.ts`). Kein Bundle, kein Framework dort einführen.
7. **UI-Änderungen sichtbar prüfen.** Ohne Tableau: `npm run dev:demo` (Mock-Dashboard + Mock-LLM) oder den statischen Demo-Modus, beide auf http://localhost:5173 (Launch-Konfigurationen `demo` und `static-demo` in `.claude/launch.json`). Im Browser ansehen und einen Screenshot machen; Gestaltung nach `docs/UI-SPEC.md`.
8. **Der Core muss allein laufen.** Was in `packages/` landet, muss mit dem Stub bauen, typprüfen und testen (`scripts/core-export.sh`, Abschnitt 8). Ein Kern-Import, den der Stub nicht kennt, bricht sonst erst den Export nach dem Release.

## 4. Arbeit auswählen

Prioritäten: Sicherheit und Datenisolation zuerst, dann ausdrückliche Wünsche des Users, dann Korrektheit, dann kleiner Umfang.

0. **Die Aufgabe des Users geht vor.** Ohne konkrete Aufgabe: `private/NEXT-STEPS.md` (nur Enterprise-Repo) lesen, Abschnitte „Offen“, „Phasenplan“ und „Workflows im Detail“ (W1–W10).
1. Offene Dependabot-PRs und Audit-Funde (`npm audit --audit-level=high` bricht die CI).
2. Grenzen und Restrisiken in den Referenzdokus (`docs/tableau-server.md` › Limits und Budgets, `docs/mcp.md` › Sicherheits- und Betriebsgrenzen).
3. Das manuelle Drehbuch `docs/testing.md`: was dort nur manuell prüfbar ist, ist ein Kandidat für einen automatischen Test.

Gezielt suchen statt das ganze Repo zu lesen: `node_modules/`, `dist/`, `dist-demo/`, `data/` und `output/` ignorieren.

## 5. Bevor du eine Aufgabe abschließt

```sh
npm run typecheck                     # alle Workspaces
npm test                              # alle Vitest-Projekte (packages/*, ee)
npm run build                         # shared → server → extension
npm audit --audit-level=high          # wenn du Abhängigkeiten geändert hast
scripts/core-export.sh /tmp/ovp-core  # wenn du Kern-Importe aus @openvizpilot/ee, ee-stub/ oder Abhängigkeiten
                                      # von ee/ geändert hast: exportiert und prüft den öffentlichen Baum (nur Enterprise-Repo)
helm lint charts/openvizpilot --set llm.baseUrl=http://litellm:4000 --set llm.apiKey=x --set app.defaultModel=m
                                      # wenn du das Chart geändert hast; die weiteren Render-Prüfungen stehen in pr-ci.yml
docker build -t openvizpilot:dev .    # wenn du Dockerfile, Bundling (tsup) oder node:-Importe geändert hast
```

Beim Iterieren weniger laufen lassen und die Befehle oben als letztes Tor behalten: `npx vitest run packages/server/test/chat-route.test.ts` führt eine Testdatei aus, `npx vitest run packages/extension` einen Workspace, `npm run typecheck -w @openvizpilot/server` prüft ein Paket. Unveränderte Tests nicht wiederholt laufen lassen, fremde Fehlschläge nicht nebenbei reparieren, sondern melden.

**Lokale Laufzeit.** `npm run dev:demo` braucht keinen LLM-Endpunkt (Mock-LLM auf :4010, Fragen mit „Filter“ oder „Revenue“ lösen Tool-Calls aus), `npm run dev:demo:sso` startet zusätzlich einen Mock-IdP. `npm run dev` und `npm run dev:claude` sind für Tableau Desktop mit `packages/extension/public/openvizpilot.dev.trex`. Die Dev-Datenbank ist SQLite unter `data/` (gitignored, nie committen).

Abschlussmeldung kurz halten: was sich geändert hat, wichtige Dateien, welche Prüfungen gelaufen sind, was offen ist. Dann aufhören: kein optionales Aufräumen, keine Extra-Doku, keine zusätzlichen Agenten ohne Auftrag. Commit nur lokal; Push und Tag nur auf ausdrücklichen Zuruf.

## 6. Parallele Agenten

- Zusätzliche Agenten nur, wenn parallele Arbeit klar Zeit spart oder die Korrektheit verbessert; nie für einfache Suchen, Ein-Datei-Fixes oder Testläufe. Nie zwei Agenten auf dasselbe Problem.
- Bewährte Aufteilung: **Scout** (relevante Dateien und Ursache finden), **Implementierer** (kleinste korrekte Änderung), **Reviewer** (Diff adversarial prüfen, Tests/Typecheck/Helm-Lint). Spezifikation als Datei übergeben, Ergebnisse zusammengefasst statt als Roh-Output weiterreichen.
- Günstigstes fähiges Modell für Scout und Implementierung; das stärkste für Sicherheit, Auth, Kryptografie, Lizenz und das Review.
- Implementierer parallel nur bei disjunkten Dateien. Geteilte Dateien (`packages/shared/src/tools.ts`, `packages/shared/src/i18n.ts`, `packages/server/src/app.ts`, `packages/server/src/env.ts`, `ee/server/src/index.ts`, `ee-stub/server/src/index.ts`, `.env.example`) bekommen kleine, gezielte Änderungen; vor dem Bearbeiten neu lesen.
- Bricht die halbfertige Änderung eines anderen den Build, warten und erneut versuchen, nicht seine Dateien reparieren.
- `package.json`-Dateien und `package-lock.json` immer gültig halten: ein kaputtes Manifest bricht `npm ci` für alle.

## 7. Wo was festgehalten wird

- `README.md`: Produkt, Pakete, Dev-Befehle, Editionen (Englisch, öffentlich sichtbar).
- `docs/`: Betriebs-, Einrichtungs- und Referenzdoku (Deutsch). Ändert sich Verhalten, das dort beschrieben ist, im selben Change mitziehen.
- `ee/README.md`: Modulkarte der Enterprise Edition und Lizenzformat (nur Enterprise-Repo).
- `private/NEXT-STEPS.md`: Erledigtes, Offenes, Phasenplan, Entscheidungen (nur Enterprise-Repo).
- `private/RELEASE.md`: Release-Ablauf privat → öffentlich, Secrets, Kunden-Lese-Token, Troubleshooting (nur Enterprise-Repo).
- `private/ADR-*.md`, `private/MACHBARKEIT-*.md`: Architekturentscheidungen und Studien (nur Enterprise-Repo).
- Das [Wiki](https://github.com/bl0rb/OpenVizPilot/wiki): Benutzerhandbuch für Endanwender (de/en).

## 8. Core-Export und Stub vollständig halten

`scripts/core-export.sh <ziel>` kopiert den Baum ohne `.git`, `node_modules`, `dist`, `ee/`, `ee-stub/`, `private/`, die `enterprise-*.yml`-Workflows, `dependabot.yml`, `.env` und `.claude/`, setzt `ee-stub/` als `ee/` ein und prüft im Ziel `npm ci`, `npm run typecheck`, `npm test` und `npm run build`. Der Workflow `enterprise-core-export-check.yml` macht das bei jedem PR. Wenn der Kern einen neuen Wert oder Typ aus `@openvizpilot/ee/...` importiert, exportiere ihn im Stub mit derselben Signatur und lizenzfreiem Verhalten (`EE_STUB` unterscheidet beide). Neue rein private Dateien gehören nach `private/` oder in die Ausschlussliste des Skripts, sonst landen sie im öffentlichen Repo. Bumpt Dependabot eine Abhängigkeit in `ee/package.json`, die auch `ee-stub/package.json` führt, zieh den Stub mit.

## Releases

- Versionen: Verhaltensänderung = Minor, sonst Patch. Ein Release-Commit („Release x.y.z“) hebt `version` und `appVersion` in `charts/openvizpilot/Chart.yaml`, `EXTENSION_VERSION` in `packages/shared/src/trex.ts` und die Version in `packages/extension/public/openvizpilot.dev.trex`.
- Der `v*`-Tag auf `main` im Enterprise-Repo startet `enterprise-publish-image.yml` (Gate: `pr-ci.yml`; Image `openvizpilot-enterprise`, cosign-signiert, SBOM) und danach automatisch `enterprise-export-core.yml`, das den Core-Export als „Core release x.y.z“ samt Tag ins öffentliche Repo pusht. Dort entstehen Core-Image, Chart und GitHub-Release.
- Tags, Pushes und Releases setzt nur der User oder ein Agent auf seinen ausdrücklichen Zuruf. Details: `private/RELEASE.md` (nur Enterprise-Repo).

## CI-Workflows

- `pr-ci.yml` (beide Repos): `npm ci`, `npm audit --audit-level=high`, Typecheck, Tests, Build; Image bauen und starten (Health- und Freigabe-Smoke-Test); Helm-Lint und Render-Prüfungen inklusive Negativfällen. Sie ist zugleich das Release-Gate der Publish-Workflows.
- `enterprise-*.yml` (nur Enterprise-Repo, mit `if: github.repository == 'bl0rb/OpenVizPilotEnterprise'`): Core-Export-Prüfung, Enterprise-Image, Core-Export. Sie werden nie exportiert.
- `publish-ghcr-images.yml`, `publish-ghcr-helm-chart.yml`, `create-github-release.yml`: laufen im öffentlichen Repo nach dem Export.
- Actions sind per SHA gepinnt (mit Versionskommentar), das Basis-Image per Digest; Dependabot hält beides aktuell. Neue Actions genauso pinnen. CI nicht nebenbei in einem Feature- oder Fix-PR ändern; braucht eine Änderung neue Prüfungen, das als eigenen Schritt benennen.
