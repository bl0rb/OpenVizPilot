# Tableau Server: Konfiguration und Betrieb

Diese Anleitung beschreibt die implementierte Enterprise-Integration bis einschließlich Phase 3. Phase 3 umfasst Feldsuche/-detail, Formeln sowie eine begrenzte Dictionary- und Impact-Grundlage; eine vollständige Lineagevisualisierung ist nicht enthalten. Sie setzt Tableau Server 2024.2 einschließlich und REST API 3.23 oder höher als Zieluntergrenze voraus; Anfragen verwenden fest die REST-Version 3.23. Die reale Live-Abnahme wurde auf Wunsch nicht durchgeführt; die Anleitung ist deshalb keine Kompatibilitätszusage für eine konkrete Installation.

## Voraussetzungen

- SQLite oder PostgreSQL für die Admin-Einstellungen.
- Enterprise-Lizenz mit `tableauServer` und `sso`.
- Funktionierende OIDC-Anmeldung. Der konfigurierte Claim muss exakt dem Tableau-Username entsprechen: `email`, `preferred_username`, `upn` oder ein benutzerdefinierter Claim.
- Der gewählte Claim muss vom IdP administrativ kontrolliert und für die Zielgruppe stabil gepflegt werden. OpenVizPilot verändert weder Domain noch Groß-/Kleinschreibung und verwendet keine Ersatzidentität.
- Je Tableau-**Site** eine eigene Tableau Connected App — entweder **Direct Trust** (Client-ID, Secret-ID,
  Secret-Wert) oder **OAuth 2.0 Trust** (Issuer-URL, JWKS; das Schlüsselpaar erzeugt die Middleware selbst und
  bedient alle Sites gemeinsam). Der JWT-Scope bleibt in beiden Fällen ausschließlich `tableau:content:read`.
- Optional: `OVP_SECRET_KEY` (mindestens 32 Zeichen, z. B. `openssl rand -hex 32`), damit Direct-Trust-Secrets
  verschlüsselt im Web gespeichert werden können, statt nur per Umgebungsvariable. Ohne diesen Schlüssel sind die
  Secret-Felder in der Admin-UI deaktiviert und nur Env-Secret-Referenzen (`OVP_TABLEAU_...`) nutzbar.
- Bei OAuth 2.0 Trust muss die Middleware unter einer festen HTTPS-Public-URL erreichbar sein, und Tableau muss die
  daraus abgeleitete Issuer-URL (`<Issuer URL>/.well-known/openid-configuration`) sowie die JWKS-URL per HTTPS
  erreichen können (Firewall/Proxy entsprechend freigeben).
- Für Metadata API auf Tableau Server muss ein Server-Admin den Metadata-Service aktivieren: `tsm maintenance metadata-services enable`. Die Aktivierung erzeugt bzw. ersetzt den Metadata-Index und kann Dienste neu starten. Data Management/Catalog ist für den vollständigen externen Asset-Kontext relevant; ohne diese Lizenz gelten zusätzliche Sichtbarkeitsgrenzen.
- Erreichbarer Tableau-Server mit vertrauenswürdiger TLS-Kette. Die Server-URL muss eine HTTPS-Origin ohne Pfad, Query, Credentials oder Fragment sein.

## Einrichtung

Beide Trust-Arten setzen eine funktionierende Single-Sign-On-Anmeldung (OIDC) und eine Enterprise-Lizenz mit `sso`
und `tableauServer` voraus; der gewählte Username-Claim (global, gilt für alle Sites) muss dem Tableau-Benutzernamen
entsprechen (auf Tableau Cloud der E-Mail-Adresse). Server-URL und Username-Claim gelten für den gesamten Tableau
Server; jede **Site** darauf bekommt in `/admin` unter **Tableau Server → Sites** eine eigene Karte mit eigenem
Auth-Modus, eigener Connected App und eigenem Secret.

### Direct Trust (je Site)

1. Site-Karte anlegen (**+ Site hinzufügen**), Name und Content-URL eintragen (leer = Default-Site; Tableau Cloud
   verlangt immer einen Wert). Authentifizierung auf **Connected App – Direct Trust** stellen.
2. In Tableau: Settings → Connected Apps → New Connected App → Direct Trust. Name, Access level und Domain
   allowlist (Public URL der Middleware) setzen, Enable connected app aktivieren.
3. Client-ID und Secret-ID in die Site-Karte eintragen.
4. Secret Value entweder direkt in der Site-Karte über **Ersetzen** speichern (verschlüsselt im Web, braucht
   `OVP_SECRET_KEY`) oder als Deployment-Umgebungsvariable mit `OVP_TABLEAU_`-Präfix bereitstellen, zum Beispiel
   `OVP_TABLEAU_CONNECTED_APP_SECRET` (Env-Referenz-Feld in der Site-Karte eintragen; in Kubernetes kann die
   Variable aus einem vorhandenen Secret kommen; nach einer Änderung alle Replicas neu starten). Der Secret-Wert
   wird nie über die Admin-API gelesen oder zurückgegeben — nur `secretConfigured: 'db' | 'env' | false`.
5. Server-URL (einmal, gilt für alle Sites) und Username-Claim (global) oben eintragen, Integration aktivieren,
   speichern.
6. **Konfiguration prüfen** validiert je Site die gespeicherte Konfiguration, Lizenz, OIDC-Bereitschaft und
   Secret-Verfügbarkeit. Diese Aktion kontaktiert Tableau nicht.
7. Nach dem Speichern den Button **Verbindung als Nutzer prüfen** der jeweiligen Site-Karte verwenden. Der Button
   ist nur bei geladener, aktivierter und unveränderter Konfiguration sowie vorhandener Lizenz und
   OIDC-Bereitschaft aktiv.

### OAuth 2.0 Trust (je Site, ein gemeinsamer Schlüssel)

OpenVizPilot tritt dabei selbst als External Authorization Server (EAS) auf: Es besitzt ein eigenes RSA-2048-
Schlüsselpaar, veröffentlicht OIDC-Discovery und JWKS unter einer Issuer-URL und stellt für jeden verifizierten
OIDC-Nutzer ein kurzlebiges RS256-JWT aus. Dieses Schlüsselpaar ist **ein gemeinsames** für alle Sites im
OAuth-2.0-Trust-Modus (Abschnitt „OAuth 2.0 Trust“, einmal, oberhalb der Sites-Liste) — es gibt kein aus Tableau
stammendes Shared Secret; der Schlüssel bleibt unter eigener Kontrolle. Der private Schlüssel verlässt Datenbank
und Prozess nie — weder über die Admin-API noch in Logs.

1. Für mindestens eine Site-Karte Authentifizierung auf **Connected App – OAuth 2.0 Trust** stellen und ohne
   weitere Angaben speichern — auch im deaktivierten Entwurf. Dabei erzeugt die Middleware einmalig den
   EAS-Schlüssel; der Abschnitt darüber zeigt danach die schreibgeschützte **Issuer URL**, **JWKS-URL** und
   **Key-ID** an.
2. Issuer URL über den Kopieren-Button übernehmen.
3. In Tableau je Site: Settings → Connected Apps → New Connected App → OAuth 2.0 Trust. Name vergeben, Issuer URL
   einfügen, Enable connected app aktivieren. Tableau zeigt danach die **Site ID** (Site-LUID) an.
4. Site ID in die jeweilige Site-Karte eintragen, Server-URL (global) sowie Username-Claim (global) eintragen,
   Integration aktivieren, speichern.
5. **Konfiguration prüfen** je Site ausführen (kontaktiert Tableau nicht).
6. **Verbindung als Nutzer prüfen** je Site ausführen.

Ändert sich die Public URL der Middleware, ändert sich auch die Issuer-URL — sie muss dann in Tableau je Site
nachgezogen werden. Vorausgesetzt: Tableau Server ab 2024.2 einschließlich bzw. Tableau Cloud.

### Dashboard-Zuordnung

Mit nur einer Site ist keine Zuordnung nötig — Suche und Metadaten lösen dann automatisch die einzige konfigurierte
Site auf. Mit mehreren Sites ordnet der Abschnitt **Dashboard-Zuordnung** jedes eingebundene Dashboard genau einer
Site zu (Auswahl aus den bereits registrierten Dashboards). Fragt ein Anwender aus einem nicht zugeordneten
Dashboard nach Tableau-Server-Inhalten, erscheint die Meldung „Dashboard ist keiner Tableau-Site zugeordnet — im
Admin unter Tableau Server zuordnen.“ statt eines Suchergebnisses.

## Was der persönliche Test macht

Der Button öffnet synchron ein Popup und startet darin den bestehenden OIDC Authorization-Code-Flow mit PKCE. Der Callback wird nur vom exakten Seiten-Origin und dem gestarteten Popup akzeptiert. Der Code wird über `/api/auth/exchange` gegen ein kurzlebiges ID-Token getauscht; dieses Token bleibt nur im Speicher der laufenden Browser-Operation.

Der persönliche Check ruft danach `/api/tableau-server/check` auf. Der Server prüft:

- Tableau-Server-Version mindestens `2024.2`.
- REST API mindestens `3.23`. Antwortet der Server auf die feste Request-Version mit Tableau-Fehler `404001`, erscheint `TABLEAU_VERSION_UNSUPPORTED`.
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
- Secret-Werte stehen weder in Settings, API-Antworten noch Logs. Im Web gespeicherte Secrets liegen AES-256-GCM-verschlüsselt in der Datenbank (Schlüssel: SHA-256 von `OVP_SECRET_KEY`); ohne diese Umgebungsvariable sind die Secret-Felder deaktiviert und nur Env-Secret-Referenzen nutzbar. Logs enthalten nur Operationsstatus, pseudonyme Nutzerkennung, Dauer und Ergebniscode.
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
