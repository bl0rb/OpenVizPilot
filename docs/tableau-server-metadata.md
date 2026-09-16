# Tableau Metadata API: Phase 3 umgesetzt

Diese Spezifikation beschreibt die umgesetzte Phase-3-Metadata-Integration für OpenVizPilot. Der Umfang umfasst Feldsuche/-detail, Formeln sowie eine begrenzte Dictionary- und Impact-Grundlage; eine vollständige Lineagevisualisierung ist nicht enthalten. Die reale Live-Abnahme gegen Tableau wurde auf ausdrücklichen Wunsch ausgelassen. Das ist kein Blocker, aber diese Dokumentation ist deshalb keine Kompatibilitätszusage für eine konkrete Tableau-Server-Installation.

## Ziel und Abgrenzung

Die Metadata API ergänzt den persönlichen REST-Content-Kontext um strukturierte Feld-, Formel- und Lineage-Metadaten. Sie liefert Metadaten, keine Rohdaten, keine Kennzahlenwerte und keine Dashboard-Exports.

Implementiert sind zwei benannte, read-only User-Tools:

- `tableau_metadata_search`: nimmt ausschließlich `{ query?, datasourceId?, limit? }` entgegen und sucht zugängliche Root-Felder mit Datasource-Zusammenfassung.
- `tableau_metadata_field`: nimmt ausschließlich `{ fieldId }` entgegen und liefert das feste Felddetail mit Formel und begrenzter Lineage.

Die Tools verwenden feste GraphQL-Queries mit Variablen. Beliebige GraphQL-Strings, Query-Fragmente oder frei wählbare Selektionsbäume aus User- oder LLM-Eingaben werden abgelehnt. Namen, Beschreibungen, Formeln, Tags und andere Tableau-Werte bleiben untrusted content und dürfen keine weiteren Tools oder Berechtigungen auslösen.

## Tableau-Voraussetzungen

Für OpenVizPilot gilt Tableau Server 2024.2 einschließlich als Zieluntergrenze; die Metadata API wird unabhängig von der REST-Request-Version über `/api/metadata/graphql` angesprochen. Die Tableau-Dokumentation beschreibt die Metadata API grundsätzlich für Tableau Server 2019.3 oder höher; daraus wird keine Zusage für ältere Server oder für jede 2024.2-/2025.3-Konfiguration abgeleitet.

Auf Tableau Server ist die Metadata API installiert, aber standardmäßig deaktiviert. Ein Server-Admin muss sie über TSM aktivieren:

```text
tsm maintenance metadata-services enable
```

Die Aktivierung startet betroffene Dienste neu und beginnt die Indexierung. Der Index kann nach Aktivierung oder nach Änderungen noch aufgebaut bzw. veraltet sein. Während eines Backfills können Ergebnisse unvollständig sein. Die API ist erst nach erfolgreicher Aktivierung und ausreichender Indexierung als nutzbarer Phase-3-Kontext zu behandeln.

Die programmgesteuerte Authentifizierung verwendet denselben Tableau-Credentials-Token wie der REST-Connector. Die Connected App erhält ausschließlich:

```text
tableau:content:read
```

Tableau dokumentiert diesen Scope als einzigen unterstützten Scope für Metadata-API-Workflows, die über REST authentifiziert werden. VDS-Scopes, Job-Scopes und Schreib-Scopes werden nicht ergänzt.

## Catalog, Data Management und Berechtigungen

Tableau Catalog indexiert Tableau-Content und externe Assets wie Datenbanken, Tabellen und Spalten. Der externe Asset-Kontext hängt von Catalog/Data Management und von den für Content und Assets wirksamen Berechtigungen ab. Data Management ist deshalb eine Voraussetzung für den vollständigen geplanten externen Asset-Kontext, aber nicht pauschal für jede Metadata-API-Abfrage.

Die Metadata API kann Beziehungen und Attribute standardmäßig obfuscaten, wenn der Benutzer keine View-Capability für verbundene Assets besitzt. Die festen Queries verwenden deshalb den Permissions-Modus `FILTER_RESULTS`: Nicht autorisierte externe Ergebnisse werden aus den Resultaten entfernt, statt als verdeckte Objekte in die Antwort zu gelangen. Fehlende oder verkürzte Lineage bleibt als Unsicherheit sichtbar.

`FILTER_RESULTS` ist keine zusätzliche Berechtigung und kein Weg um Tableau-Rechte herum. Bei fehlender Berechtigung, fehlendem Data Management oder nicht aktiviertem Derived-Permissions-Modell darf OpenVizPilot keine Details ergänzen oder aus Namen und Beziehungen erschließen.

## Query-Schnitt

Die statisch festgelegten Queries bilden einen begrenzten, bereits gegen die offiziellen Tableau-Schema-Dokumente geprüften Teil des GraphQL-Schemas ab. Fixture-Tests decken die Query-Form und die Normalisierung ab; eine Live-Abnahme ist ausdrücklich nicht Teil dieser Arbeit. Typecheck, Build und der gemockte Desktop-/Mobile-Chattoolflow sind bestanden; der Gesamtstand beträgt 470 Tests in 61 Dateien.

| Query-Baustein | Zweck | Begrenzung |
|---|---|---|
| Root `fieldsConnection` | `tableau_metadata_search` nach `query`, optionaler `datasourceId` und `limit`. | Feste Rückgabefelder; Root-Ergebnis höchstens 500 Felder pro Operation. |
| Datasource summary | Zusammenfassung der zugehörigen Datenquelle im Root-Ergebnis. | Nur die im festen Query-Shape vorgesehenen Werte; keine Owner-, Projekt-, Rollen- oder Aggregationsbehauptung. |
| Calculated formula | `tableau_metadata_field` liefert die berechnete Formel, sofern Tableau sie indexiert und autorisiert liefert. | Formeltext ist Inhalt, keine Anweisung; keine Ausführung. |
| Upstream fields | Direkte Feldherkunft im Felddetail. | Höchstens 10 Felder; feste Tiefe. |
| Upstream columns | Externe Spaltenherkunft im Felddetail. | Höchstens 10 Spalten; jede Tabelle nur als `{ id, name }`. |
| Downstream sheets | Nachgelagerte Sheets mit Workbook-Zusammenfassung. | Höchstens 20 Sheets; feste Tiefe. |
| Downstream workbooks | Nachgelagerte Workbooks. | Höchstens 20 Workbooks; kein vollständiger Impact Explorer. |

Die Queries bleiben read-only und nutzen ausschließlich Variablen. GraphQL-Fehler verwerfen auch gleichzeitig gelieferte Teildaten vollständig. Fehlende oder gefilterte Beziehungen ohne GraphQL-Fehler dürfen als begrenzter Kontext zurückgegeben werden.

## Tools und Antworten

`tableau_metadata_search` nimmt nur `{ query?, datasourceId?, limit? }` entgegen; das Ergebnislimit ist standardmäßig 20, maximal 50. `datasourceId` wird lokal innerhalb der höchstens 500 abgerufenen Felder gefiltert, nicht serverweit. Das Ergebnis enthält Root-Felder und eine Datasource-Zusammenfassung, soweit autorisiert und indexiert geliefert. Bei mehreren gleichnamigen Feldern muss das Modell anhand der gelieferten Feld- und Datasource-Werte nachfragen oder die Mehrdeutigkeit nennen. Nicht gelieferte Owner-, Projekt-, Rollen- oder Aggregationswerte werden nicht ergänzt.

`tableau_metadata_field` arbeitet auf einem ausgewählten Metadata-`fieldId`, nicht auf REST-LUIDs oder Extension-IDs. Es kann berechnete Formel, feste Felddetails, bis zu 10 Upstream-Felder, bis zu 10 Upstream-Spalten mit Tabellenzusammenfassung, bis zu 20 Downstream-Sheets mit Workbook-Zusammenfassung und bis zu 20 Downstream-Workbooks liefern. Es darf keine nicht gelieferten Details erfinden.

Die festen Metadata-Queries liefern keine Sheet-Pfade oder Source-URLs. Formeln können beispielsweise RAWSQL-Ausdrücke als Text enthalten; sie werden weder ausgeführt noch für separate Rohdaten- oder SQL-Abfragen verwendet.

Die Data-Dictionary-Grundlage besteht aus stabilen, normalisierten Einträgen für Feld, Beschreibung, Formel, Datenquelle, Tabelle/Spalte und gelieferte Beziehungen, soweit diese Daten autorisiert und indexiert geliefert werden. Owner, Projekt, Rolle und Aggregation gehören nicht zum garantierten Metadata-Schema. Sie ist kein dauerhafter, unbeschränkter Ergebnis-Cache.

Explain-Metric verwendet diese Grundlage zur Disambiguierung eines Feldes und trennt anschließend klar zwischen aktuellem Dashboard-Kontext und Tableau-Server-Metadaten. Eine Erklärung darf bei fehlender oder widersprüchlicher Lineage Unsicherheit melden; sie darf keine scheinbare Gewissheit aus einem Namen ableiten.

## Begrenzungen und Fehlerverhalten

- Bestehende HTTPS-, Ziel-, Response-Größen-, OIDC- und Lizenz-Gates gelten unverändert.
- Metadata-Aufrufe sind read-only und verwenden feste Queries mit Variablen.
- Pro Operation gilt ein Root-Limit von höchstens 500 Feldern und ein Gesamtbudget von 10 Sekunden. Nested Connections sind zusätzlich auf 10 Upstream-Felder, 10 Upstream-Spalten, 20 Downstream-Sheets und 20 Downstream-Workbooks bei fester Tiefe begrenzt.
- Jede Upstream-Antwort ist auf 1 MiB begrenzt; das normalisierte Backend-Ergebnis ist auf 20.000 UTF-8-Bytes begrenzt, der Extension-Fallback auf 20.000 Zeichen. Kürzungen werden gekennzeichnet; Formeln über 4.096 Zeichen werden vollständig ausgelassen, nicht angeschnitten.
- Index-Backfill und veraltete Indexdaten sind nicht zuverlässig erkennbar. Fehlende, redigierte oder begrenzte Beziehungen können als Limitation markiert werden; erfolgreiche gefilterte Ergebnisse sind kein Vollständigkeitsnachweis.
- Nicht aktivierte Metadata API, fehlende Berechtigung, nicht unterstützte Query-Felder und GraphQL-Fehler führen zu bereinigten klassifizierten Fehlern. Rohfehler, Query-Details und Tokens werden nicht an Browser oder LLM weitergereicht.
- Bei GraphQL-Fehlern gilt Fail-closed für den gesamten Metadata-Kontext der Operation: keine Übernahme gleichzeitig gelieferter Teildaten, keine erfundenen Ergänzungen und keine Ausweitung auf Admin-Zugriff. Der normale Live-Dashboard-Chat bleibt verfügbar.
- `updatedAt` bleibt ein Content-Änderungswert und ist kein Index-Frische-, Daten- oder Extract-Refresh-Nachweis. `retrievedAt` bezeichnet den Abrufzeitpunkt.
- Feldnamen, Datasource-Zusammenfassungen, Formeln und Beziehungen werden wie REST-Suchergebnisse an den konfigurierten LLM-Anbieter übermittelt. Das ist bei Anbieterfreigabe und Datenverarbeitung zu berücksichtigen; Tableau-Tokens und Connected-App-Secrets werden nicht mitgesendet.

## Nicht Teil von Phase 3

- VDS und Abfragen veröffentlichter Datenquellen.
- Admin-Copilot, Jobs, Tasks, Schedules und `tableau:jobs:read`.
- Extract-Refresh-Orchestrierung; JWT-Extract-Refresh-Tasks für Tableau Cloud sind kein Tableau-Server-Fallback.
- Metadata-Schreiboperationen, Tagschreiben, Berechtigungsänderungen und Data-Management-Administration.
- Vollständiger Impact Explorer oder serverweiter Vollständigkeitsnachweis.
- Beliebige GraphQL-Abfragen aus User- oder LLM-Eingaben.

## Primärquellen

- [Tableau Metadata API: Get Started](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html)
- [Tableau Metadata API: How to Authenticate](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_auth.html)
- [Tableau Metadata API: How Permissions Work](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_permissions.html)
- [Tableau Metadata API: Example Queries](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_examples.html)
- [Tableau Metadata API: Understand the Metadata Model](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_model.html)
- [Tableau Metadata API: Common Errors](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_errors.html)
- [Enable Tableau Catalog](https://help.tableau.com/current/server/en-us/dm_catalog_enable.htm)
- [Manage Permissions for External Assets](https://help.tableau.com/current/server/en-us/dm_perms_assets.htm)
- [Configure Connected Apps with Direct Trust](https://help.tableau.com/current/server/en-us/connected_apps_direct.htm)
- [Access Scopes for Connected Apps](https://help.tableau.com/current/server/en-us/connected_apps_scopes.htm)
- [tsm maintenance](https://help.tableau.com/current/server/en-us/cli_maintenance_tsm.htm)
