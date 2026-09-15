# Tableau Server REST: Phase-2-Matrix

Dieses Dokument beschreibt den implementierten REST-Ausschnitt und seine Grenzen. Tableau-Objekte werden nur unter der persönlichen Tableau-Identität gelesen. Der Connector verwendet REST API 3.27 als feste Request-Version und akzeptiert im Connection-Test nur Server `>= 2025.3` und REST API `>= 3.27`.

## OpenVizPilot-Endpunkte

| Endpoint | Authentifizierung | Zweck | Status |
|---|---|---|---|
| `POST /api/tableau-server/check` | Persönliches OIDC-Bearer-ID-Token | Serverinfo plus vier Lesbarkeitsprobes; Antwort enthält `ok`, `stage: "connection"`, Versionen und Probe-Codes. | Implementiert |
| `POST /api/tableau-server/search` | Persönliches OIDC-Bearer-ID-Token | Workbook-/View-Finder; `all` umfasst nur Workbooks und Views. Projekte und Datasources bleiben Connection-Test-Primitives. | Implementiert |
| `POST /api/admin/tableau-server/check` | Admin-Token | Reiner Konfigurationscheck; führt keinen Tableau-Request und keinen User-Sign-in aus. | Implementiert |

## Upstream-Endpoint-Matrix

| Ressource | Verwendete REST-Primitives | Phase-2-Verwendung | Scope / Rolle | Quelle |
|---|---|---|---|---|
| Serverinfo | `GET /api/3.27/serverinfo` | Version und REST-API-Version im persönlichen Connection-Test. | Laut Tableau ohne Authentifizierung; kein JWT-Scope erforderlich. | [Server Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm) |
| Workbooks | Site-Collection `GET .../sites/{site-id}/workbooks` mit `pageSize`/`pageNumber` | Eine der vier Collection-Probes; Finder nach Name/ID, Projekt, Owner und Tag. | Leserechte des persönlichen Tableau-Users; `tableau:content:read`. | [Workbooks and Views Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm) |
| Views | Site-Collection `GET .../sites/{site-id}/views` mit `pageSize`/`pageNumber` | Eine der vier Collection-Probes; Finder nach Name/ID, Projekt, Owner und Tag. Workbook-Zuordnung wird für sichere View-Links genutzt. | Leserechte des persönlichen Tableau-Users; `tableau:content:read`. | [Workbooks and Views Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm) |
| Projects | Site-Collection `GET .../sites/{site-id}/projects` mit `pageSize`/`pageNumber` | Eine der vier Connection-Test-Probes; read-only Primitive, nicht Teil des aktuellen Finders. | Leserechte des persönlichen Tableau-Users; `tableau:content:read`. | [Projects Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm) |
| Datasources | Site-Collection `GET .../sites/{site-id}/datasources` mit `pageSize`/`pageNumber` | Eine der vier Connection-Test-Probes; read-only Primitive, nicht Teil des aktuellen Finders. | Leserechte des persönlichen Tableau-Users; `tableau:content:read`. | [Data Sources Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_datasources.htm) |
| Jobs, Tasks, Schedules | Job-/Task-Methoden aus dem offiziellen REST-Referenzbereich | Nicht in Phase 2. Für einen späteren Admin-Copilot in Phase 6 vorgesehen. | `tableau:jobs:read` wäre admin-only; wird aktuell nicht angefordert. | [Jobs, Tasks, and Schedules Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm) |
| Extracts und Encryption | Extract-/Refresh-/Encryption-Methoden aus dem offiziellen REST-Referenzbereich | Nicht implementiert. Insbesondere kein JWT-Cloud-Extract-Refresh-Task als Tableau-Server-Fallback. | Kein zusätzlicher Scope in Phase 2; `tableau:content:read` bleibt der einzige Connector-Scope. | [Extract and Encryption Methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm) |

Die Workbooks-/Views-Referenz enthält außerdem Tag-Methoden. Phase 2 verwendet Tags ausschließlich als gelesene Suchmetadaten; Schreiboperationen und zusätzliche Tag-Scopes gehören nicht zum Connector.

## Connection-Test

Der persönliche Test liest zuerst `serverinfo` und prüft die beiden Mindestversionen. Danach liest er genau eine paginierte Seite jeder Collection: Workbooks, Views, Projects und Datasources. Die Antwort enthält damit fünf Status-Einträge: einen für `serverinfo` und vier für die Collection-Probes. `serverinfo` ist laut Tableau ohne Authentifizierung möglich; die vier Site-Collections laufen unter der persönlichen Session. Jede Probe meldet ein eigenes `resource`, `ok` und bei Fehlern einen klassifizierten `code`. Gesamtstatus ist nur dann erfolgreich, wenn Versionen kompatibel sind und alle vier Collection-Probes erfolgreich sind.

Das ist ein Erreichbarkeits- und Lesbarkeitscheck, kein Vollscan. Der Admin-Konfigurationscheck bleibt davon getrennt und darf keine Live-Aktion auslösen.

## Search-Budgets und Pagination

Der Finder verwendet serverseitige Pagination mit höchstens 100 Datensätzen pro Seite und einem OpenVizPilot-Scanbudget von 500 Datensätzen je Anfrage. `type: "workbook"` scannt Workbooks; `type: "view"` scannt höchstens 250 Workbooks für Parent-Metadaten und verwendet das verbleibende Budget für Views; `type: "all"` scannt nur Workbooks und Views. Projekte und Datasources werden nicht vom Finder gescannt. Ergebnisse werden nach Name/ID, Projekt, Owner und Tag gefiltert.

Das Trefferlimit ist standardmäßig 20 und darf höchstens 50 sein. Das 10-Sekunden-Budget umfasst Pagination, Normalisierung und die zugrunde liegenden REST-Aufrufe. Nicht lesbare Collections sowie erschöpfte Scan- oder Trefferbudgets werden mit `truncated` und `limitations` gekennzeichnet. Abbruch, Timeout und ungültig gewordene Sessions verwerfen das Ergebnis. `updatedAt` wird, falls Tableau es liefert, als Content-Metadatum übernommen; es wird nicht als Refresh- oder Extract-Status interpretiert.

Suchen mit Views verwenden stabile 50er-Seiten, reine Workbook-Suchen 100er-Seiten. Dadurch begrenzt das 500er-Budget auch die abgerufenen Datensätze. Höchstens acht Operationen laufen gleichzeitig pro Prozess; weitere Anfragen erhalten HTTP 429. Jede Upstream-Antwort ist auf 1 MiB begrenzt. Der Extension-Client begrenzt das Tool-Ergebnis auf 20.000 Zeichen gültiges JSON und kennzeichnet dabei entfernte Treffer als abgeschnitten.

Quelllinks verwenden nur die konfigurierte HTTPS-Origin. Fehlende View-Links werden ausschließlich aus dem unterstützten `Workbook/sheets/View`-Format von `contentUrl` und der konfigurierten Site abgeleitet; unbekannte Formate erhalten keinen erfundenen Link. Siehe [Tableau View-URL-Struktur](https://help.tableau.com/current/pro/desktop/en-us/embed_structure.htm). Projekt- und Owner-Metadaten von Views stammen, soweit vorhanden, aus ebenfalls berechtigt gelesenen Workbooks; Owner-Namen sind nicht in jeder API-Antwort enthalten.

## Metadata-Abgrenzung

Metadata API ist in Phase 3 umgesetzt und wird in einer separaten Spezifikation beschrieben: [tableau-server-metadata.md](tableau-server-metadata.md). Die REST-Matrix behauptet keine vollständige Catalog- oder Lineagevisualisierung.

## Nicht Teil dieser Matrix

Metadata API, GraphQL, Felder, berechnete Felder, Worksheets und begrenzte Lineage sind Phase-3-Funktionen; die vollständige Lineagevisualisierung, VDS, Refresh-Orchestrierung und serverweite Admin-Governance bleiben außerhalb dieses Umfangs. Ihre Aufnahme in die offiziellen Tableau-Referenzen bedeutet keine Zusage, dass eine konkrete Tableau-Installation sie mit dem aktuellen Connector unterstützt.
