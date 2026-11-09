# AGENTS.md — OpenVizPilot

## Arbeitsweise

- Die konkrete Aufgabe vollständig mit dem kleinsten korrekten Diff lösen. Sicherheit und Datenisolation haben Vorrang; ausdrücklicher Auftrag, Korrektheit, kleiner Umfang und sparsamer Einsatz von Tokens, Tools und Agenten folgen.
- Fremde Änderungen erhalten. Keine beiläufigen Refactorings, Umbenennungen, Formatierungen, Features, Abhängigkeiten oder Abstraktionen. Vorhandene Muster und Helfer verwenden.
- Bei Fehlern mit Reproduktion, Meldung oder betroffenem Test beginnen. Definitionen und Aufrufer lesen, bevor eine Ursache angenommen wird; auch eine vorgegebene Fehlerstelle ist zu prüfen.
- Mit `rg` gezielt suchen und nur relevante Abschnitte lesen. `node_modules/`, `dist/`, `dist-demo/`, `data/` und `output/` überspringen. Nicht erneut lesen oder testen, solange sich weder Inhalt noch Fragestellung geändert haben.
- Aus dem Auftrag arbeiten; keine Folgeaufgaben selbst auswählen und keine Pflicht-Roadmap, Claim-Commits oder zusätzlichen Planungsdokumente anlegen. Nur bei einer wirklich fehlenden Entscheidung oder Berechtigung fragen; bereits erteilte Freigaben gelten weiter.

## Projekt und Zuständigkeiten

OpenVizPilot ist ein KI-Copilot für Tableau: Dashboard-Extension mit Vite/Preact, Node.js-Middleware mit Hono und gemeinsame zod-Verträge. TypeScript bleibt strict und ESM; npm-Workspaces und Node-Version richten sich nach `.nvmrc` und den Manifesten. Produktname: **OpenVizPilot**, Pakete: `@openvizpilot/*`, Konfiguration: `OVP_*`.

Entwicklung erfolgt in **OpenVizPilotEnterprise**. Das öffentliche **OpenVizPilot** ist ein Core-Export; dort nicht direkt entwickeln oder committen. Diese Anleitung wird mitexportiert. Als **Enterprise-only** markierte Pfade fehlen im öffentlichen Export und sind dort keine Pflichtlektüre.

| Bereich | Zuständig / Einstieg |
|---|---|
| Request-/Response-Schemas, SSE, Dashboard-Tools, i18n, Markdown, `.trex` | `packages/shared/`; kennt keine anderen Workspaces |
| Middleware, Auth/Freigaben, LLM-Anbindung, Routen, Admin-UI und Anwendungsspeicher | `packages/server/` |
| Dashboard-Kontext, Chat-/Tool-Schleife, Tableau-Aktionen und Extension-UI | `packages/extension/` |
| Lizenz, SSO, Personalisierung, MCP, Tableau Server, Watch, Desktop-Agent | `ee/`; echte Implementierung nur im Enterprise-Repo, öffentlich ein Stub |
| Lizenzfreier Ersatz mit derselben Schnittstelle | `ee-stub/` (Enterprise-only); wird beim Export zu `ee/` |
| Betrieb und Auslieferung | `charts/openvizpilot/`, `deploy/compose/`, `Dockerfile` |
| Native Desktop-Oberfläche | Eigenes Repository [OpenVizPilotDesktop](https://github.com/bl0rb/OpenVizPilotDesktop); hier nur der Serverteil |

Dokumentation nach Aufgabe auswählen, nicht vollständig laden:

- [README.md](README.md): Produkt und Einstieg; [docs/architecture.md](docs/architecture.md): Datenfluss und Architekturgrenzen.
- [docs/contributing.md](docs/contributing.md): Checklisten für Tools, Konfiguration, Enterprise-Funktionen und Texte; [docs/development.md](docs/development.md): Befehle und Export; [docs/testing.md](docs/testing.md): manuelle Integrationsprüfungen.
- [docs/UI-SPEC.md](docs/UI-SPEC.md): Gestaltung; [docs/admin-deployment.md](docs/admin-deployment.md) und [docs/enterprise.md](docs/enterprise.md): Betrieb und Lizenzierung.
- [docs/desktop.md](docs/desktop.md), [docs/tableau-server.md](docs/tableau-server.md), [docs/tableau-mcp.md](docs/tableau-mcp.md), [docs/mcp.md](docs/mcp.md), [docs/watch.md](docs/watch.md), [docs/user-approvals.md](docs/user-approvals.md): jeweilige Funktions- und Sicherheitsgrenzen.
- Die README des betroffenen Workspace; interne Pläne, ADRs und Release-Abläufe unter `private/` nur bei Bedarf (Enterprise-only).

## Datenisolation und Sicherheit

- Tableau-Daten nur mit der persönlichen Identität der angemeldeten Person lesen: in der Extension über deren Tableau-Sitzung, serverseitig über deren eigene IdP-Identität. Keine PATs, Service-Accounts, fremden Benutzerkennungen oder vertrauenswürdigen Identitäten aus ungeprüften Client-Headern.
- Serverseitige Datenzugriffe benötigen die passende Lizenz, Admin-Freigabe je Person und deren Einwilligung; Site-Schalter, Budgets und Audit bleiben zusätzlich wirksam. Fehlende Berechtigungen nicht durch breitere Abfragen oder einen anderen Zugriffspfad umgehen. Die konkrete Prüfung vor Registrierung/Ausführung der Tools beibehalten.
- Site-Kontext erhalten: Dashboard-Extension an die zugeordnete Site binden; bei siteübergreifender Desktop-/MCP-Suche Identitäten, Freigaben und Limits je Site prüfen. Einzelabrufe müssen die Site des Treffers verwenden, da IDs nicht global sind. Teilausfälle als Einschränkung ausweisen, nicht als vollständigen Erfolg.
- Lizenzpflichtige Funktionen serverseitig vor der Ausführung prüfen. Dashboard-Aktionen bleiben sichtbare Vorschläge bis zum Klick; ohne `actions`-Lizenz weder Aktionsanleitung im Prompt noch ausführbare Chips. Auskunft und Löschung bereits gespeicherter persönlicher Fakten nicht an eine aktive Lizenz knüpfen.
- Logs enthalten nur Metadaten, keine Nachrichten, Dashboard-Snapshots, Tool-Ergebnisse oder rohen Upstream-Fehler. Gesprächsverläufe bleiben im Client; Anwendungsspeicher ist kein Dashboard-Cache. Persönliche Memory-Fakten nicht aus Dashboard-Daten extrahieren.
- LLM-Schlüssel und OIDC-Client-Secrets bleiben serverseitig. Admin-Secrets über die vorhandene Verschlüsselung und `OVP_SECRET_KEY` behandeln. Keine echten Schlüssel, Lizenz-Token oder personenbezogenen Testdaten committen.
- Jede Änderung an Auth, Lizenz, Freigaben oder Datenzugriff braucht gezielte Ablehnungsfälle, einschließlich fehlender Voraussetzungen und manipulierter Identitätsangaben. Schutzmechanismen nicht lockern, um einen Test oder eine Demo erfolgreich zu machen.

## Implementieren und erweitern

- Verträge in `packages/shared/src` pflegen; keine getrennten, auseinanderlaufenden Protokolle für Server und Client. SSE-Abschluss, Fehler, Einwilligungsbedarf und Abbruch unterscheiden. Entscheidungen anhand validierter Felder treffen, nicht anhand von Meldungstexten.
- Dashboard-Tools erweitern `toolArgSchemas`, `toolDefinitions` und den passenden Executor samt Mock und Tests nach `docs/contributing.md`. Executor-Fehler weiterhin kontrolliert über die Registry zurückgeben; keine unbehandelten Exceptions oder aufgehobenen Ergebnislimits.
- Core importiert Enterprise nur über `@openvizpilot/ee/server` bzw. `@openvizpilot/ee/extension`. Lizenzpflichtige Logik, Schemas, Prompt-Bausteine und UI bleiben in `ee/`. Jeden vom Core verwendeten Export im Stub mit gleicher Signatur und Verhalten ohne Lizenz erhalten; gemeinsame Abhängigkeitsversionen synchron halten.
- Neue `OVP_*`-Variablen im Env-Schema, `.env.example`, passenden Helm-Werten/Templates und der Betriebsdoku berücksichtigen. Secrets über Secret-Referenzen führen; alte Namen nur über `LEGACY_ENV_NAMES` kompatibel halten.
- Sichtbare Extension-Texte über `packages/shared/src/i18n.ts` in `de` und `en`; vorhandene Platzhalter erhalten. `README.md` bleibt Englisch, `docs/` und erklärende Code-Kommentare Deutsch. Kommentare erklären die geschützte Annahme, nicht bloß den Code.
- `/admin` bleibt Vanilla-JS in den vorhandenen Templates, ohne neue Build-Kette. UI-Muster aus `docs/UI-SPEC.md` verwenden; Tastatur, Fokus sowie Lade-, Leer- und Fehlerzustände berücksichtigen.
- Externe Eingaben validieren; Laufzeiten, Wiederholungen, Parallelität und Ergebnismengen begrenzen. Abbruch und Aufräumen erhalten. Fehlgeschlagene oder leere Ergebnisse nicht zu scheinbaren Erfolgen umdeuten und konfigurierte Modelle nicht still austauschen.
- Tests standardmäßig mit synthetischen Daten, temporärem Speicher, Mock-LLM/IdP und kontrollierten Diensten ausführen. Keine echten Tableau-Daten, kostenpflichtigen Aufrufe, produktiven Freigaben oder realen Benachrichtigungen als beiläufigen Test verwenden.

## Gezielte Prüfung

Zuerst den betroffenen Test, dann bei Bedarf Workspace und angrenzende Verträge prüfen. Vorhandene Werkzeuge verwenden; kein `npm install` nur für einen Prüfaufruf. Neue oder geänderte Funktionalität erhält passende Regressionstests, die den ursprünglichen Fehler erkennen; reine Text-/Formatänderungen brauchen keine Anwendungstests.

| Änderung | Kleinster sinnvoller Einstieg, vom Repo-Root |
|---|---|
| TypeScript-Verhalten | `npm test -- packages/server/test/<datei>.test.ts` bzw. die relevante Datei unter `packages/*/test/` oder `ee/test/` |
| Workspace-Typen | `npm run typecheck -w @openvizpilot/server`; Paket entsprechend der Änderung wählen |
| Gemeinsame Verträge / mehrere Workspaces | Betroffene Sender-/Empfängertests; bei paketübergreifenden Auswirkungen `npm run typecheck`, `npm test` und `npm run build` |
| Extension-UI | `npm run dev:demo` oder `npm run dev:static-demo -w @openvizpilot/extension`; Ablauf im Browser prüfen und Screenshot festhalten |
| Abhängigkeiten | `npm audit --audit-level=high`, betroffene Tests/Builds und gegebenenfalls Stub-Abgleich |
| Helm-Chart | `helm lint charts/openvizpilot --set llm.baseUrl=http://litellm:4000 --set llm.apiKey=x --set app.defaultModel=m`; betroffene Render-/Negativfälle aus der CI |
| Dockerfile / Server-Bundling | `docker build -t openvizpilot:dev .` und relevante Smoke-Prüfungen |
| Core-/Enterprise-Imports, Stub oder EE-Abhängigkeiten | Vollständigen Core-Export in ein frisches temporäres Ziel prüfen (Enterprise-only, siehe unten) |
| Nur Dokumentation | Pfade, Befehle und Aussagen gegen aktuelle Quellen prüfen; Diff kontrollieren |

Platzhalter durch echte Testdateien/Pakete ersetzen. Vollständige Typecheck-/Test-/Build-Gates in [.github/workflows/pr-ci.yml](.github/workflows/pr-ci.yml) bleiben Voraussetzung für Code-PRs und Releases; lokale Auswahl ersetzt sie nicht. Unveränderte Prüfungen nicht wiederholen, fremde Fehler nicht nebenbei reparieren. Mock-Tests belegen weder echte Tableau-RLS noch einen Live-SSO- oder Plattformlauf; fehlende Prüfungen ausdrücklich benennen.

## Core-Export, Git und Zusammenarbeit

- `scripts/core-export.sh <ziel>` (Enterprise-only) ersetzt `ee/` durch den Stub und führt im Ziel Installation, Typecheck, Tests und Build aus. Ein frisches temporäres Ziel verwenden: das Skript synchronisiert mit Löschungen. Nie auf einen fremden Checkout oder ein Verzeichnis mit erhaltenswerten Dateien zeigen.
- Private Dateien gehören nach `private/` oder in die Export-Ausschlüsse. Echte Enterprise-Implementierung, interne Pläne, Secrets und private Workflows dürfen nicht in den öffentlichen Export gelangen. `AGENTS.md` und `CLAUDE.md` müssen auch im Export verständlich bleiben; `CLAUDE.md` importiert diese Datei.
- Zusätzliche Agenten nur für klar unabhängige Arbeit mit erkennbarem Zeit- oder Qualitätsgewinn, nicht für einfache Suchen, Ein-Datei-Fixes oder Testläufe. Das günstigste fähige Modell nutzen; stärkere Modelle für schwierige Ursachen, Sicherheitsgrenzen oder entsprechend anspruchsvolle Reviews.
- Aufgaben und Dateien trennen, Ergebnisse knapp weitergeben und vorhandene Erkenntnisse wiederverwenden. Bei drei Agenten: Scout, Implementierung, Review. Parallele Schreibarbeit bei Bedarf in eigenen Worktrees; geteilte Verträge, Manifeste und Lockdateien unmittelbar vor Änderungen prüfen. Fremde halbfertige Arbeit nicht überschreiben oder ohne neue Erkenntnis wiederholt abwarten.
- Vor Git-Aktionen Branch, Index und Diff prüfen. Neue Branches bei Bedarf mit `codex/`, sofern der User nichts anderes vorgibt. Nur den beauftragten Umfang committen; keine fremden Änderungen verwerfen oder Branches umschreiben. Push, Tags und Releases nur auf ausdrücklichen Auftrag; vorhandene Freigaben nicht erneut erfragen.
- CI-Änderungen nur soweit für die Aufgabe erforderlich: SHA-Pins für Actions, Image-Digests, minimale Rechte und begrenzte Jobs erhalten. Prüfungen nicht zum Verdecken eines Fehlers abschalten. Enterprise-Workflows bleiben privat und an das Enterprise-Repo gebunden.
- Für Releases gilt die bestehende Versionspolitik: Verhaltensänderung Minor, sonst Patch; Chart, `EXTENSION_VERSION` und Dev-Manifest gemeinsam aktualisieren. Ablauf und automatischen Export vor einem beauftragten Release in `private/RELEASE.md` nachlesen (Enterprise-only), keine Versionen beiläufig erhöhen.

## Abschluss

- Bestehende Dokumentation aktualisieren, wenn sie durch die Änderung falsch wird. Checklisten verlinken statt kopieren; keine Pflicht-Devlogs oder doppelten Roadmaps. Wiederkehrende Fallstricke knapp am zuständigen Ort erklären.
- Finalen Diff auf Umfang, Schutzmechanismen und ehrliche Aussagen prüfen. In höchstens 5–8 Zeilen melden: Änderung, wichtige Dateien, tatsächlich ausgeführte Prüfungen und verbleibende Probleme; lokale Tests, CI und Live-Prüfungen unterscheiden.
- Sobald Auftrag und relevante Prüfung abgeschlossen sind, aufhören. Keine optionalen Refactorings, zusätzlichen Tests, Dokumente oder Agentenaufgaben anschließen.

## Herkunft

Eigenständige Projektregeln auf Basis der vorhandenen OpenVizPilot-Dokumentation und ausgewählter Prinzipien aus [Craft Core](https://github.com/storytold/craft-contrib/blob/main/standards/house-rules-core.md), [Craft Anything](https://github.com/storytold/craft-anything/blob/main/AGENTS.md) und [Craft Common Actions](https://github.com/storytold/craft-common-actions/blob/main/README.md). Diese Links dokumentieren die Herkunft; sie erben keine fremden Regeln und sind keine Pflichtlektüre für Aufgaben.
