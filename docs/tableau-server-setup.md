# Tableau Server: Konfiguration und Betrieb

Diese Anleitung beschreibt die implementierte Enterprise-Integration bis einschließlich Phase 3. Phase 3 umfasst Feldsuche/-detail, Formeln sowie eine begrenzte Dictionary- und Impact-Grundlage; eine vollständige Lineagevisualisierung ist nicht enthalten. Sie setzt Tableau Server 2025.3 einschließlich und REST API 3.27 oder höher als Zieluntergrenze voraus. Die reale Live-Abnahme wurde auf Wunsch nicht durchgeführt; die Anleitung ist deshalb keine Kompatibilitätszusage für eine konkrete Installation.

## Voraussetzungen

- SQLite oder PostgreSQL für die Admin-Einstellungen.
- Enterprise-Lizenz mit `tableauServer` und `sso`.
- Funktionierende OIDC-Anmeldung. Der konfigurierte Claim muss exakt dem Tableau-Username entsprechen: `email`, `preferred_username`, `upn` oder ein benutzerdefinierter Claim.
- Der gewählte Claim muss vom IdP administrativ kontrolliert und für die Zielgruppe stabil gepflegt werden. OpenVizPilot verändert weder Domain noch Groß-/Kleinschreibung und verwendet keine Ersatzidentität.
- Tableau Connected App mit Direct Trust, Client-ID, Secret-ID und Secret-Wert. Der JWT-Scope bleibt ausschließlich `tableau:content:read`.
- Für Metadata API auf Tableau Server muss ein Server-Admin den Metadata-Service aktivieren: `tsm maintenance metadata-services enable`. Die Aktivierung erzeugt bzw. ersetzt den Metadata-Index und kann Dienste neu starten. Data Management/Catalog ist für den vollständigen externen Asset-Kontext relevant; ohne diese Lizenz gelten zusätzliche Sichtbarkeitsgrenzen.
- Erreichbarer Tableau-Server mit vertrauenswürdiger TLS-Kette. Die Server-URL muss eine HTTPS-Origin ohne Pfad, Query, Credentials oder Fragment sein.

## Einrichtung

1. Secret-Wert als Deployment-Umgebungsvariable mit `OVP_TABLEAU_`-Präfix bereitstellen, zum Beispiel `OVP_TABLEAU_CONNECTED_APP_SECRET`. In Kubernetes kann die Variable aus einem vorhandenen Secret kommen. Nach einer Änderung alle Replicas neu starten.
2. In `/admin` **Tableau Server** öffnen. Server-URL als Origin eintragen, etwa `https://tableau.example.com`. Für die Default-Site bleibt die Site-Inhalt-URL leer.
3. Client-ID, Secret-ID und den Namen der Secret-Umgebungsvariable eintragen. Der Secret-Wert wird nie über die Admin-API gesendet.
4. Username-Claim auswählen. Werte werden exakt verwendet; es gibt keinen Domain-, Großschreibungs- oder Identitäts-Fallback.
5. Integration aktivieren und speichern. **Konfiguration prüfen** validiert gespeicherte Konfiguration, Lizenz, OIDC-Bereitschaft und Secret-Verfügbarkeit. Diese Aktion kontaktiert Tableau nicht.
6. Nach dem Speichern den Button **Verbindung als Nutzer prüfen** verwenden. Der Button ist nur bei geladener, aktivierter und unveränderter Konfiguration sowie vorhandener Lizenz und OIDC-Bereitschaft aktiv.

## Was der persönliche Test macht

Der Button öffnet synchron ein Popup und startet darin den bestehenden OIDC Authorization-Code-Flow mit PKCE. Der Callback wird nur vom exakten Seiten-Origin und dem gestarteten Popup akzeptiert. Der Code wird über `/api/auth/exchange` gegen ein kurzlebiges ID-Token getauscht; dieses Token bleibt nur im Speicher der laufenden Browser-Operation.

Der persönliche Check ruft danach `/api/tableau-server/check` auf. Der Server prüft:

- Tableau-Server-Version mindestens `2025.3`.
- REST API mindestens `3.27`.
- Lesbarkeit der vier Primitives `workbooks`, `views`, `projects` und `datasources`; zusammen mit `serverinfo` erscheinen fünf Status-Einträge.

Das Ergebnis nennt Versionen und einzelne Probe-Status. Erfolg wird nur bei `stage: "connection"`, `ok: true` und ausschließlich erfolgreichen Probes angezeigt.

## Suche und Chat

Das Tool `tableau_server_search` sucht persönliche, zugängliche Workbooks und Views nach Name/ID, Projekt, Owner und Tag. Der `all`-Modus umfasst nur Workbooks und Views. Projekte und Datenquellen sind Connection-Test-Primitives, aber keine aktuellen Finder-Ressourcen. Die Suche liest keine Kennzahlen, Zeilen- oder Dashboarddaten.

Die Grenzen pro Anfrage sind:

- höchstens 500 gescannte Datensätze;
- bei einer View-Suche höchstens 250 Workbook-Datensätze, danach das verbleibende Budget für Views;
- standardmäßig 20 Treffer;
- maximal 50 Treffer;
- maximal 10 Sekunden Gesamtbudget.

Bei abgeschnittenen oder teilweise nicht lesbaren Ergebnissen werden `truncated` und `limitations` gesetzt. Kein Treffer ist bei einem begrenzten Scan kein Beweis für Nichtexistenz. `retrievedAt` ist der Abrufzeitpunkt; `updatedAt` ist eine Content-Änderung und kein Refresh-Nachweis.

Die Chat-Integration ist auf Tableau-Analytics-Discovery begrenzt. Allgemeine Tableau-Server-Verwaltung und Job-Abfragen sind nicht im User-Scope. Die umgesetzte Metadata API und semantische Feld-/Lineage-Grundlage werden über `tableau_metadata_search { query, datasourceId?, limit }` und `tableau_metadata_field { fieldId }` mit festen Queries und eigenen Aktivierungsgrenzen angebunden.

`tableau_metadata_search` liefert Root-Felder und Datasource-Zusammenfassung. `tableau_metadata_field` liefert das Detail eines ausgewählten `fieldId`, einschließlich berechneter Formel und begrenzter Herkunft/Nutzung. Gelieferte URL- oder Pfadmetadaten dürfen angezeigt bzw. an den LLM-Anbieter weitergegeben werden; erfundene Source-URLs, Tokens und Secrets werden niemals ergänzt oder weitergegeben.

Suchtreffer werden als Tool-Ergebnisse an den konfigurierten LLM-Anbieter übermittelt. Dazu können Content-Namen, Tags, Owner-/Projektangaben und interne Tableau-Quelllinks gehören. Das ist bei der Freigabe des Anbieters und seiner Datenverarbeitung zu berücksichtigen. Tableau-Tokens und Connected-App-Secrets werden nicht mitgesendet.

## Scopes und bewusst ausgelassene Funktionen

- Implementiert: `tableau:content:read`.
- Auf Phase 6 verschoben: `tableau:jobs:read`, ausschließlich für einen getrennten admin-only Jobs-/Governance-Pfad.
- Nicht implementiert: Extract-Refresh-Tasks über JWT für Tableau Cloud; dieser Cloud-Pfad ist kein Tableau-Server-Fallback.
- Umgesetzt: Metadata API, externe Asset-Sichtbarkeit, Feldsuche/-detail, Formeln sowie begrenzte Lineage-, Dictionary- und Impact-Grundlage; siehe [tableau-server-metadata.md](tableau-server-metadata.md). Eine vollständige Lineagevisualisierung und beliebige GraphQL-Abfragen sind ausgeschlossen.
- Nicht implementiert: VDS und Admin-Copilot.

## Betrieb und Fehlerbehandlung

- Konfigurationen werden mit Revision gespeichert. Bei HTTP 409 neu laden und Änderungen erneut anwenden.
- Secret-Werte stehen weder in Settings, API-Antworten noch Logs. Logs enthalten nur Operationsstatus, pseudonyme Nutzerkennung, Dauer und Ergebniscode.
- Tableau-Session-Credentials bleiben im Prozessspeicher und werden bei Ablauf, Konfigurationswechsel, Abschalten oder Logout best effort abgemeldet.
- Sign-in-JWTs sind auf höchstens 60 Sekunden ausgelegt. Credentials-Tokens bleiben höchstens fünf Minuten im Prozessspeicher und nie länger als die OIDC-Identität gültig ist.
- Der Hintergrundabgleich prüft aktive Verbindungen alle 30 Sekunden. Auf anderen Replicas kann ein Config-/Lizenzwechsel wegen des bestehenden Auth-State-Caches bis zu etwa 15 Sekunden später wirksam werden.
- Logout ist best effort: lokale Credentials werden verworfen und Tableau-Sign-out versucht. Lokales Löschen widerruft weder ein OIDC-ID-Token beim IdP noch garantiert es bei Netzwerkausfall eine sofortige Tableau-Revokation.
- Bei Secret-Rotation neue Secret-ID und Env-Secret bereitstellen, alle Replicas neu starten, Konfiguration speichern und das alte Secret erst danach in Tableau zurückziehen. Alte lokale Sessions werden unbrauchbar; ein fehlgeschlagener Sign-out ist möglich.
- Connection- und Suchoperationen werden nach 10 Sekunden abgebrochen. Responses sind zusätzlich größenbegrenzt; Redirects und unsichere Ziele werden abgewiesen.
- Bei OIDC-, TLS-, Berechtigungs-, Versionierungs- oder REST-Fehlern zeigt die Anwendung eine bereinigte Fehlermeldung. Rohantworten von Tableau werden nicht weitergereicht.
- Reload, Save, Reset und ungespeicherte Feldänderungen brechen einen laufenden Browser-Test ab und verwerfen sein Ergebnis.

## Live-Abnahme

Die reale Prüfung mit Connected App, Site, Claim und zwei Berechtigungsprofilen wurde auf ausdrücklichen Wunsch nicht ausgeführt. Das ist für die dokumentierte Phase kein Blocker. Vor produktiver Freigabe muss eine separate Abnahme gegen die Zielinstallation die Version, OIDC-Claim-Zuordnung, Site-Rechte, vier REST-Probes, Suchgrenzen und Secret-Rotation prüfen.

Weitere technische Details und die Quellenmatrix stehen in [tableau-server-rest.md](tableau-server-rest.md) und [tableau-server-integration.md](tableau-server-integration.md).
Die Metadata-Spezifikation steht in [tableau-server-metadata.md](tableau-server-metadata.md).
