# Tableau Server Integration: Referenz

Die optionale Enterprise-Integration (`ee/server/src/tableau-server/`) ergänzt den Live-Dashboard-Kontext der Extension um serverseitige, berechtigungsgeprüfte Content-Suche und Feldmetadaten. Sie liefert Metadaten, keine Kennzahlen-, Zeilen- oder Dashboarddaten. Die Einrichtung steht in [tableau-server-setup.md](tableau-server-setup.md).

## Sicherheitsmodell

- Jede Aktion läuft unter der **persönlichen** Tableau-Identität des angemeldeten Nutzers, abgeleitet aus einem administrativ konfigurierten OIDC-Claim (`usernameClaim`). Es gibt keinen globalen Service-Account, keinen PAT-Fallback und keinen frei übergebenen Username.
- Der ausgestellte JWT trägt ausschließlich den Scope `tableau:content:read` (`ee/server/src/tableau-server/client.ts`, `eas.ts`). Kein `tableau:jobs:read`, kein VDS-Scope.
- Read-only: REST-Suche und Metadata API liefern nur lesbare Content-Metadaten und Formeln; es gibt keine Schreiboperationen, keinen SQL-/Rohdatenzugriff und keine Extract-Refresh-Funktion.
- Zugriff erfordert zusätzlich eine per-Nutzer-Freigabe `tableauApi` (unabhängig von `ai`), serverseitig bei jedem Request geprüft — siehe [user-approvals.md](user-approvals.md). Feature-Gate: Enterprise-Lizenz mit `tableauServer` und `sso` (`packages/server/src/app.ts`).
- Secrets (Direct-Trust-Secret-Value, EAS-Private-Key) verlassen Datenbank/Prozess nie über die Admin-API oder Logs; im Web gespeicherte Secrets liegen AES-256-GCM-verschlüsselt vor (`ee/server/src/secrets.ts`).

## Connected-App-Modi

Je Site wird einer von zwei Modi konfiguriert (`ee/server/src/tableau-server/config.ts`, `client.ts`):

- **Direct Trust**: HS256-JWT, signiert mit dem in Tableau hinterlegten Connected-App-Secret (`clientId`/`secretId`/Secret-Value als `iss`/`kid`/Schlüssel).
- **OAuth 2.0 Trust**: RS256-JWT, signiert mit einem middleware-eigenen RSA-2048-Schlüsselpaar. Die Middleware tritt dabei selbst als External Authorization Server (EAS) auf: Sie veröffentlicht OIDC-Discovery und JWKS unter einer eigenen Issuer-URL (`ee/server/src/tableau-server/eas.ts`) und stellt für jeden verifizierten OIDC-Nutzer ein kurzlebiges Sign-in-JWT aus. Ein Schlüsselpaar bedient alle Sites im OAuth-2.0-Trust-Modus.

Beide Modi verwenden ausschließlich den Scope `tableau:content:read`.

## Per-Site-Konfiguration und Dashboard-Zuordnung

Eine Tableau-Server-Instanz (Server-URL, Username-Claim, REST-API-Version) kann mehrere **Sites** enthalten; jede Site trägt ihren eigenen Auth-Modus, Connected App und Secret (`TableauSite` in `config.ts`). Bei mehreren Sites ordnet eine Dashboard→Site-Zuordnung (`dashboardSites`) jedes eingebundene Dashboard genau einer Site zu; ohne Treffer meldet der Connector `TABLEAU_SITE_UNRESOLVED`. Mit genau einer konfigurierten Site entfällt die Zuordnung. Das konkrete Vorgehen steht in [tableau-server-setup.md](tableau-server-setup.md).

## Chat-Tools

Definiert in `ee/server/src/tableau-server/tools.ts`, bedingt registriert je nach Freigabe/Lizenz:

| Tool | Parameter | Zweck |
|---|---|---|
| `tableau_server_search` | `query?`, `type?: all\|workbook\|view`, `project?`, `owner?`, `tag?`, `limit? (1–50, Default 20)` | Findet zugängliche Workbooks/Views nach Name, Projekt, Owner oder Tag; liefert Metadaten und Quelllinks, keine Dashboarddaten. |
| `tableau_metadata_search` | `query?`, `datasourceId?`, `limit? (1–50, Default 20)` | Sucht autorisierte Metadata-API-Feldkandidaten mit Datasource-Zusammenfassung. |
| `tableau_metadata_field` | `fieldId` (erforderlich) | Liefert Felddetail: Formel, bis zu 10 Upstream-Felder, 10 Upstream-Spalten, 20 Downstream-Sheets, 20 Downstream-Workbooks. |

Alle drei Tools verwenden feste, variablengebundene Abfragen; beliebiges GraphQL oder freie REST-Parameter aus User-/LLM-Eingaben werden nicht akzeptiert. Namen, Tags, Beschreibungen und Formeln aus den Ergebnissen sind unvertrauenswürdige Daten, niemals Anweisungen.

## HTTP-Endpunkte

Definiert in `ee/server/src/tableau-server/routes.ts` und `eas-routes.ts`; Mounts in `packages/server/src/app.ts` und `packages/server/src/routes/admin.ts`.

| Endpoint | Auth | Zweck |
|---|---|---|
| `POST /api/tableau-server/check` | Persönliches OIDC-Bearer-ID-Token | Verbindungstest: Serverversion, REST-API-Version, vier Lesbarkeitsproben (Workbooks/Views/Projects/Datasources). |
| `POST /api/tableau-server/search` | Persönliches OIDC-Bearer-ID-Token | Backend für `tableau_server_search`. |
| `POST /api/tableau-server/metadata/search` | Persönliches OIDC-Bearer-ID-Token | Backend für `tableau_metadata_search`. |
| `POST /api/tableau-server/metadata/field` | Persönliches OIDC-Bearer-ID-Token | Backend für `tableau_metadata_field`. |
| `GET /api/admin/tableau-server` | Admin-Session | Liest gespeicherte Konfiguration (Secrets nur als `secretConfigured: 'db'\|'env'\|false`). |
| `PUT /api/admin/tableau-server` | Admin-Session | Speichert Konfiguration (optimistische Revision). |
| `DELETE /api/admin/tableau-server` | Admin-Session | Löscht die Konfiguration. |
| `POST /api/admin/tableau-server/check` | Admin-Session | Reiner Konfigurations-/Lizenz-/OIDC-Check ohne Tableau-Request. |
| `GET /tableau-eas/.well-known/openid-configuration` | Öffentlich | OIDC-Discovery-Dokument für den middleware-eigenen EAS (OAuth 2.0 Trust). |
| `GET /tableau-eas/jwks.json` | Öffentlich | Öffentlicher Schlüsselsatz für den EAS. |

## Limits und Budgets

- Request-Timeout und Gesamtbudget je Operation: 10 Sekunden (`http.ts`, `metadata.ts`).
- Max. Response-Größe je Upstream-Antwort: 1 MiB.
- Suche: Scanbudget 500 Datensätze je Aufruf; View-Suche nutzt höchstens 250 Datensätze davon für Workbook-Zuordnung, Rest für Views (`rest.ts`). Trefferlimit Default 20, max. 50.
- Metadata: Root-Suche höchstens 500 Felder; je Felddetail höchstens 10 Upstream-Felder, 10 Upstream-Spalten, 20 Downstream-Sheets, 20 Downstream-Workbooks (`metadata.ts`). Normalisiertes Backend-Ergebnis auf 20.000 Bytes begrenzt; Formeln über 4.096 Zeichen werden vollständig ausgelassen.
- Höchstens 8 gleichzeitige Tableau-Operationen pro Prozess; weitere Aufrufe schlagen mit `tableau_busy` fehl (`service.ts`).

## Mindestversion

Tableau Server **2024.2** einschließlich, REST API **3.23** (`TABLEAU_MIN_SERVER_VERSION`, `TABLEAU_REST_API_VERSION` in `ee/server/src/tableau-server/config.ts`). Der Connector verwendet 3.23 als feste Request-Version für alle REST-Aufrufe; neuere Server beantworten dies unverändert.
