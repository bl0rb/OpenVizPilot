# Desktop-App (Enterprise)

Die Desktop-App ([bl0rb/OpenVizPilotDesktop](https://github.com/bl0rb/OpenVizPilotDesktop), Open Source, Tauri 2, macOS/Windows) stellt
Fragen an die Tableau-Umgebung **ohne geöffnetes Dashboard**. Die Dashboard-Extension bleibt
unverändert — die App ist ein zweiter Client derselben Middleware mit eigenem Endpunkt.

## Was sie kann — und was nicht

| | Dashboard-Extension | Desktop-App |
|---|---|---|
| Datenbasis | das geöffnete Dashboard (Extensions API, 10 Live-Tools) + Tableau-Server-Tools | nur Tableau-Server-Tools: Workbook-/View-Suche, Metadata API, Datenquellen (VizQL Data Service), View-Daten |
| Agenten-Loop | in der Extension (statuslose Middleware) | **serverseitig** in der Middleware (`POST /api/desktop/chat`) |
| Modi | Fragen, Untersuchen, Gesamte Umgebung | Fragen (8 Tool-Runden), Untersuchen (24 Runden, Plan → Hauptursache/Belege/Quellen) |
| Aktionen, Memory, Watch, MCP, Scope-Guard | ja | nein (Themen-Scope nur per System-Prompt) |
| Anmeldung | Konten oder SSO | nur SSO (OIDC) — die Tableau-Tools brauchen die persönliche Identität |

## Voraussetzungen

1. Enterprise-Lizenz mit `tableauServer` und `sso`; für Daten (statt nur Metadaten) `serverData`.
2. Anmeldung „Single Sign-On“ und eine aktive Tableau-Server-Konfiguration mit **genau einer
   Site** — ohne Dashboard gibt es keine Dashboard→Site-Zuordnung.
3. Je Person die Freigaben „KI“ und „Tableau-API“ (Admin → Benutzer & Zugriff); für Daten
   zusätzlich „Serverdaten“ und die Einwilligung der Person (die App zeigt sie beim ersten
   Datenzugriff als Karte; `POST /api/tableau-server/consent` wie in der Extension).

Am Identity-Provider ist **nichts** zu ändern: Die App nutzt die registrierte Callback-URL
`<Public URL>/auth/callback`; die Seite leitet einen `state` der Form `desktop-<port>-<zufall>`
an `http://127.0.0.1:<port>/callback` weiter (RFC 8252). Der Code ist an den PKCE-Verifier der
App gebunden und wird über `POST /api/auth/exchange` eingelöst.

## Endpunkte

- `GET /api/desktop/session` — Identität, Freigaben, ob der Agent verfügbar ist (sonst
  `reason`: `oidc_required` | `approval_required` | `tableau_unavailable`), Einwilligungen
  samt Texten.
- `POST /api/desktop/chat` — Body `{ messages: [{ role: user|assistant, content }], mode?:
  ask|investigate, model? }` (keine system-Rolle, kein Dashboard-Kontext). SSE-Events:
  `delta` (Text), `tool` (`{ id, name, arguments, status: running|done, preview }`),
  `consent_required` (`{ scope: views|datasource, text }`), `notice`, `final`
  (`{ content, followups }`), `done`, `error`, `ping`.

Hürden je Request: OIDC-Identität, Freigabe „Tableau-API“ (sonst 403), aktive Integration
(sonst 503). Die Daten-Tools (`tableau_view_data`, `tableau_datasource_fields`,
`tableau_datasource_query`) sind nur mit Lizenz `serverData` und Freigabe „Serverdaten“
registriert; Einwilligung, Site-Schalter, Budgets (8 View- bzw. 12 Datenquellen-Aufrufe je
2 Minuten) und Audit (`purpose: desktop`) gelten wie in der Extension. Der System-Prompt entsteht
ausschließlich serverseitig (`ee/server/src/desktop/agent.ts`); Modellwahl und Nutzungsstatistik
laufen über denselben Katalog und dieselben Zähler wie der Dashboard-Chat (zusätzlich
`desktop_turn` je Modus).
