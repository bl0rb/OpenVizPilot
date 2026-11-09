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
2. Anmeldung „Single Sign-On“ und eine aktive Tableau-Server-Konfiguration mit mindestens einer
   Site. Ohne Dashboard gibt es keine Dashboard→Site-Zuordnung: Die App arbeitet mit **allen
   konfigurierten Sites** (siehe „Mehrere Sites“ unten).
3. Je Person die Freigaben „KI“ und „Tableau-API“ (Admin → Benutzer & Zugriff); für Daten
   zusätzlich „Serverdaten“ und die Einwilligung der Person (die App zeigt sie beim ersten
   Datenzugriff als Karte; `POST /api/tableau-server/consent` wie in der Extension).

Am Identity-Provider ist **nichts** zu ändern: Die App nutzt die registrierte Callback-URL
`<Public URL>/auth/callback`; die Seite leitet einen `state` der Form `desktop-<port>-<zufall>`
an `http://127.0.0.1:<port>/callback` weiter (RFC 8252). Der Code ist an den PKCE-Verifier der
App gebunden und wird über `POST /api/auth/exchange` eingelöst.

## Mehrere Sites

Die Dashboard-Extension bleibt an die Site gebunden, der ihr Dashboard zugeordnet ist. Die
Desktop-App (und der [Tableau-MCP-Server](tableau-mcp.md)) sucht dagegen **siteübergreifend**:

- Die Such-Tools (`tableau_server_search`, `tableau_metadata_search`, `tableau_datasource_search`)
  laufen ohne Angabe über alle nutzbaren Sites — je Site ein Aufruf unter der persönlichen
  Identität, also mit dem Konto und den Rechten der Person auf genau dieser Site. Treffer werden
  zusammengeführt und tragen `site` (Site-Name aus der Admin-Konfiguration); `sites` nennt je Site
  Trefferzahl oder `skipped` (kein Konto, Anmeldung fehlgeschlagen, nicht erreichbar), `busy`
  (Tableau-Integration ausgelastet) bzw. `timeout` (keine Antwort innerhalb der Frist). Jede fehlende Site steht
  zusätzlich in `limitations` (fester Klartext, nie Tableaus Fehlermeldung) — die übrigen Sites
  liefern trotzdem. Fallen alle Sites aus, gilt der erste Fehler.
- Der Fan-out fragt prozessweit — über alle gleichzeitigen Suchen aller Personen — höchstens vier
  Sites gleichzeitig ab und wartet sonst auf einen freien Platz; so kann der Fan-out allein das Limit
  des Service (8 laufende Tableau-Aufrufe je Prozess) nicht ausschöpfen. Einzelaufrufe von
  Desktop-App, Tableau-MCP, Extension und Watch zählen weiterhin direkt gegen dieses Limit. Eine Suche
  dauert höchstens 20 Sekunden (je Site-Aufruf höchstens 10); nicht beantwortete Sites gelten als
  `timeout`. Eine mit `busy` abgewiesene Site wird einmal wiederholt.
- Lehnt Tableau die Anmeldung einer Person auf einer Site ab (kein Konto, Benutzer passt nicht,
  Connected App abgelehnt — nicht bei vorübergehenden Fehlern wie 429 oder 5xx), überspringt der
  Fan-out diese Site für diese Person 10 Minuten lang ohne erneuten Versuch (`skipped`); Speichern
  der Tableau-Konfiguration hebt das auf, ein ausdrücklich mit `site` gewählter Aufruf versucht es
  weiterhin.
- Ist das Ergebnis zu groß, bleiben Treffer reihum je Site erhalten; `sites` zählt dann nur die
  enthaltenen Treffer, und `limitations` nennt je Site, wie viele ausgelassen wurden.
- Die Einzelabrufe (`tableau_metadata_field`, `tableau_view_data`, `tableau_datasource_fields`,
  `tableau_datasource_query`) verlangen den Parameter `site` aus dem Treffer, denn IDs und LUIDs
  gelten nur innerhalb ihrer Site. Das Modell bekommt die Site-Namen als feste Auswahl (`enum`);
  fehlt oder passt der Wert nicht, antwortet das Tool mit den verfügbaren Sites statt zu raten.
  Tragen mehrere Sites denselben Namen (auch nur in Groß-/Kleinschreibung verschieden), erhält jede
  davon die Content-URL (Standard-Site: die ID) als Zusatz, z. B. „Sales (emea)“.
- Mit genau einer Site gibt es den Parameter nicht, und Treffer tragen kein `site`.
- Site-Schalter („Serverseitige Daten erlauben“, „Datenquellen abfragen“) und Audit gelten je Site;
  die Audit-Zeile nennt die gewählte Site. Die Budgets (siehe unten) zählen dagegen je Person über
  alle Sites zusammen — Desktop-App und Tableau-MCP teilen sich dasselbe Budget.
- Nutzbar ist eine Site, wenn ihr Secret bzw. der EAS-Schlüssel vorliegt; eine Site ohne nutzbares
  Secret fehlt in der Auswahl (Grund im Diagnoseprotokoll). Ob die Person auf einer Site ein Konto
  hat, zeigt erst die Anmeldung bei Tableau. Die **Namen aller nutzbaren Sites sind daher für jede
  Person mit Freigabe „Tableau-API“ sichtbar** (Session, System-Prompt, Tool-Auswahl im MCP) — Admins
  wählen neutrale Site-Namen.

`GET /api/desktop/session` liefert in `agent.sites` die Namen der nutzbaren Sites.

## Endpunkte

- `GET /api/desktop/session` — Identität, Freigaben, ob der Agent verfügbar ist (sonst
  `reason`: `oidc_required` | `approval_required` | `tableau_unavailable`; sonst `sites`),
  Einwilligungen samt Texten.
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
