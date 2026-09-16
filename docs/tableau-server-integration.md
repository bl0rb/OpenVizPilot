# Tableau Server Integration: Feature-Liste und Umsetzungsplan

Die optionale Tableau-Server-Integration ergänzt den bestehenden Live-Kontext der Extension um serverseitige, berechtigungsgeprüfte Content-Metadaten. Die Erfassung von Live-Dashboarddaten erfolgt weiterhin in der Tableau-Session des jeweiligen Viewers; ausgewählter Kontext wird wie bisher an Middleware und LLM übergeben. Die Middleware liest Serverdaten nur unter der persönlich gemappten, verifizierten OIDC-Identität.

## Aktueller Stand

Phase 0 ist abgeschlossen. Phase 1 ist implementiert. Phase 2 ist für die unten beschriebenen REST-Basisfunktionen implementiert. Phase 3 Metadata und Semantik ist **umgesetzt**: Feldsuche/-detail, Formeln sowie eine begrenzte Dictionary- und Impact-Grundlage sind vorhanden; eine vollständige Lineagevisualisierung ist nicht enthalten. Die Live-Abnahme gegen eine reale Tableau-Installation wurde auf Wunsch ausdrücklich ausgelassen. Das ist kein Blocker für diesen Entwicklungsstand und stellt keine Kompatibilitätszusage für eine konkrete Installation dar.

Die Zieluntergrenze ist Tableau Server 2024.2 einschließlich mit REST API 3.23 oder höher; sie wurde am 16.09.2026 von 2025.3/3.27 abgesenkt, weil alle genutzten REST-Primitives bereits in 3.23 enthalten sind und der Connector 3.23 als feste Request-Version verwendet. Diese Untergrenze ist eine Implementierungsanforderung, kein durch einen Live-Test bestätigtes Supportversprechen.

## Implementierte Funktionen

| Bereich | Status und Umfang |
|---|---|
| Benutzerfreigaben | KI-Chat und Tableau-API pro lokaler oder verifizierter SSO-Identität getrennt durch Admins freigegeben; standardmäßig gesperrt, serverseitig geprüft. [Ablauf und Migration](user-approvals.md). |
| Admin-Konfiguration | Enterprise-Feature `tableauServer`; HTTPS-Server-Origin, Site, Connected-App-IDs, Secret-Env-Referenz und Username-Claim; SQLite/PostgreSQL-Revisionen. |
| Persönlicher Connection-Test | Admin-Button **Verbindung als Nutzer prüfen**; OIDC Authorization Code + PKCE im Popup; persönlicher Bearer-ID-Token nur im Browser-Speicher der laufenden Operation; kein manueller Token-Input. |
| Connection-Test | Authentifiziert persönlich, prüft Server-Version `>= 2024.2`, REST API `>= 3.23` und liest vier Endpoint-Probes: Workbooks, Views, Projects und Datasources. Die Antwort enthält fünf Status-Einträge inklusive `serverinfo`. Gesamtbudget: 10 Sekunden. Mocked PKCE-, Timeout-, Desktop- und Mobile-Browser-Verifikation ist erfolgreich. |
| Workbook-/View-Finder | Chat-Tool `tableau_server_search`; Suche nach Name/ID, Projekt, Owner und Tag; nur zugängliche Metadaten und sichere Quelllinks, keine Dashboarddaten. Der `all`-Modus umfasst nur Workbooks und Views. |
| Projekte und Datenquellen | Read-only REST-Primitives sind für den Connection-Test vorhanden. Sie sind aktuell keine Finder-Ressourcen. |
| Metadata API | **Umgesetzt**; `tableau_metadata_search { query, datasourceId?, limit }` und `tableau_metadata_field { fieldId }` mit festen GraphQL-Abfragen, Formeln und begrenzten Upstream-/Downstream-Beziehungen. Kein beliebiges GraphQL aus User-Eingaben. |
| Begrenzungen | Pro Suchaufruf höchstens 500 gescannte Datensätze; Standardlimit 20 Treffer; höchstens 50 Treffer; bei View-Suche höchstens 250 Workbook-Scans plus verbleibendes View-Budget; 10-Sekunden-Gesamtbudget; `truncated` und `limitations` werden ausgegeben. |
| Assistant-Integration | Prompt-Regeln, Tool-Definition, Extension-Dispatch und Scope-Guard für die Tableau-Server-Suche sind implementiert. |

`updatedAt` bezeichnet eine Content-Änderung. Es ist kein Nachweis für einen Daten- oder Extract-Refresh. Der Abrufzeitpunkt wird separat als `retrievedAt` geführt.

## Zukunfts-Backlog

Diese Funktionen bleiben bewusst außerhalb der implementierten Phase 2. Die Metadata-bezogenen Einträge werden in Phase 3 vorbereitet bzw. umgesetzt:

| Status | Feature | API / Hinweis |
|---|---|---|
| Teilweise umgesetzt | Dashboardübergreifende Suche | REST + Metadata; Workbooks/Views über `tableau_server_search`, Felder über `tableau_metadata_search` umgesetzt; Datenquellen sind noch keine Finder-Ressource. |
| Geplant | Explain this metric | Metadata + Extension-Kontext; Feld-, Workbook- und Lineage-Bezug. |
| Teilweise umgesetzt | Calculated-Field-Erklärung | Metadata; `tableau_metadata_field` liefert Formel und begrenzte Upstream-Felder; die fachliche Erklärung bleibt dem Chat überlassen. |
| Teilweise umgesetzt | Data Dictionary | Begrenzte Metadata-Grundlage für Feld, Beschreibung, Formel, Datenquelle, Tabelle/Spalte und gelieferte Beziehungen; Ausbau offen. |
| Geplant | Lineage Explorer | Vollständige visuelle Lineage über Datenquelle, Tabelle, Spalte, Workbook und Worksheet. |
| Teilweise umgesetzt | Impact Analysis | Begrenzte Downstream-Grundlage über gelieferte Sheets und Workbooks; kein vollständiger Impact Explorer. |
| Geplant | Freshness Assistant | REST; Refresh-Status erst mit einer dafür geeigneten API, nicht aus `updatedAt`. |
| Geplant | Datasource Health | REST; Owner, Projekt, Status, Verbindungsinformationen und Tags. |
| Geplant | Permissions erklären | REST; sichtbare Berechtigungen und mögliche Gründe für fehlenden Zugriff. |
| Geplant | Revision History erklären | REST; Revisionen auflisten und fachlich einordnen. |
| Später | Serverweite Datenanalyse und AI-Drilldowns | VDS mit separater Allowlist, Limits und Datenfreigabe. |
| Phase 6 | Admin Copilot | Jobs, Tasks, Refreshes und Governance; admin-only mit `tableau:jobs:read`. |

## Sicherheits- und Produktgrenzen

- Die Integration ist opt-in und bleibt ohne aktive, gültige Konfiguration inaktiv.
- User-Funktionen verwenden die persönliche Tableau-Identität. Ein globaler Admin-PAT oder ein frei übergebener Username ist kein Fallback.
- Der Connected-App-JWT verwendet ausschließlich `tableau:content:read`.
- Die Suche liefert nur vom persönlichen Tableau-Konto lesbare Inhalte. Ein begrenzter Scan ist keine Aussage, dass ein nicht gefundener Inhalt serverweit nicht existiert.
- `tableau:jobs:read` ist für einen späteren, admin-only Job-/Governance-Pfad in Phase 6 reserviert. Es wird nicht für die User-Suche oder den Connection-Test angefordert.
- Extract-Refresh-Tasks über JWT für Tableau Cloud gehören nicht zum Server-Umfang dieser Integration. Es gibt deshalb keinen Refresh-Task-Fallback und keine Refresh-Aussage aus `updatedAt`.
- Metadata API, Felder, berechnete Felder, begrenzte Lineage und externe Asset-Sichtbarkeit gehören zur umgesetzten Phase 3. Sie sind nicht Teil der implementierten Phase 2; eine vollständige Lineagevisualisierung bleibt ausgenommen.

## Phase 0 und 1

Die verbindlichen Architektur- und Threat-Model-Entscheidungen stehen in [tableau-server-phase-0.md](tableau-server-phase-0.md). Die laufende Einrichtung beschreibt [tableau-server-setup.md](tableau-server-setup.md).

- [x] Enterprise-Lizenzgate `tableauServer` und OIDC-Gate.
- [x] Secret ausschließlich über `OVP_TABLEAU_*`-Env-Referenz; keine Secret-Werte in Settings, Antworten oder Logs.
- [x] Connected-App-JWT für die serverseitig verifizierte OIDC-Identität.
- [x] Isolierter, kurzlebiger Tableau-Session-Cache und best-effort Sign-out.
- [x] Admin-Konfigurationsprüfung ohne Live-Tableau-Aktion.
- [x] Persönlicher Popup-Test für Authentifizierung und REST-Verbindung.

## Phase 2: REST-Basisfunktionen

- [x] Versionierter, enger REST-Client mit HTTPS-, Ziel-, Response- und Timeout-Grenzen.
- [x] Persönlicher Connection-Test mit Serverinfo und vier Collection-Probes; fünf Status-Einträge insgesamt.
- [x] Read-only Workbooks-, Views-, Projects- und Datasources-Primitives; Finder-Suche nur für Workbooks und Views.
- [x] Workbook-/View-Finder mit Name/ID, Projekt, Owner und Tag.
- [x] Pagination, Scanbudget 500, bei View-Suche maximal 250 Workbook-Scans plus verbleibendes View-Budget, Trefferlimits 20/50, 10-Sekunden-Budget und Truncation-Hinweise.
- [x] `tableau_server_search` mit persönlichem Authorization-Bearer und bereinigten Ergebnissen.
- [x] Prompt- und Scope-Integration; bei Tableau-Fehlern bleibt die Dashboard-Analyse verfügbar.
- [x] REST-Endpoint-Matrix in [tableau-server-rest.md](tableau-server-rest.md).
- [x] Phase-2-/Phase-4-Tests; der aktuelle Gesamtstand umfasst 470 grüne Tests in 61 Dateien. Typecheck, Build und gemockter Desktop-/Mobile-Chattoolflow sind bestanden.
- [ ] Live-Abnahme auf einer realen Tableau-Server-Installation. Auf Wunsch ausgelassen; kein Blocker und keine Kompatibilitätsbehauptung.

## Phase 3: Metadata und Semantik (umgesetzt)

- [x] Metadata-API-Client und feste, variablegebundene GraphQL-Abfragen; kein beliebiges User-GraphQL.
- [x] `tableau_metadata_search` mit Root-Feldern und Datasource-Zusammenfassung sowie `tableau_metadata_field` mit berechneter Formel und fester Detail-Lineage.
- [x] Begrenzungen: 500 Root-Felder, 10 Upstream-Felder, 10 Upstream-Spalten, 20 Downstream-Sheets und 20 Downstream-Workbooks; 20.000 Bytes Backend-Output, 20.000 Zeichen Extension-Fallback, 1 MiB Upstream-Antwort und 10 Sekunden.
- [x] Begrenzte Data-Dictionary-Grundlage und Explain-metric-Disambiguierung mit dem Chat-Kontext.
- [x] Begrenzte Impact-Ansicht über Downstream-Sheets und -Workbooks; kein vollständiger Impact Explorer und keine vollständige Lineagevisualisierung.
- [x] Tests mit Metadata-Fixtures, festen `FILTER_RESULTS`-Queries, Fehlern mit Teildaten und redigierten Knoten; vollständiger Testlauf: 470 Tests in 61 Dateien. Danach 20 gezielte Tests inklusive zweier zusätzlicher Regressionen bestanden; Typecheck und Build erneut erfolgreich. Index-Frische bleibt nicht nachgewiesen.

Details und Betriebsgrenzen stehen in [tableau-server-metadata.md](tableau-server-metadata.md).

## Phase 4: Assistant-Integration

Die für die Phase-2-Suche erforderlichen Phase-4-Teile sind erledigt:

- [x] System-Prompt-Regeln für Tableau-Server-Kontext.
- [x] Bedingt registriertes Tool `tableau_server_search`.
- [x] Scope-Guard-Regel: nur Tableau-Analytics-Discovery, keine allgemeine Serververwaltung.
- [x] Quellen- und Truncation-Hinweise sowie Trennung von Live-Dashboard und Tableau-Server-Kontext.

Die Metadata-Integration ist umgesetzt und bleibt hinter ihren eigenen Aktivierungs- und Berechtigungsgrenzen. VDS, Admin-Jobs, Extract-Refreshes und beliebiges GraphQL bleiben außerhalb dieses Vorhabens.

## Phase 5 und 6

Phase 5 umfasst Betrieb und Governance: Audit-Metriken ohne Inhalte, Deployment-Dokumentation, Datenschutz und Go-live-Prüfung.

Phase 6 kann einen getrennten Admin-Copilot für Jobs, Tasks, Refreshes und Governance untersuchen. Dafür ist `tableau:jobs:read` admin-only vorzusehen; der Scope wird weder dem persönlichen Content-Connector noch dem Phase-2-Finder hinzugefügt. VDS und AI-Drilldowns bleiben ebenfalls Phase 6 oder später.

## Akzeptanzgrenzen

Als implementiert gelten die automatisierten Tests für Auth, Claims, REST-Normalisierung, Bounded Search, Fehlerbereinigung, Scope-/Tool-Integration und deaktivierte Konfiguration. Ein erfolgreicher Testlauf gegen eine echte Tableau-Installation ist ausdrücklich nicht Teil dieser Abnahme. Daher dokumentiert diese Datei eine implementierte technische Grenze, keine Zusage für jede Tableau-Server- oder Connected-App-Konfiguration.
