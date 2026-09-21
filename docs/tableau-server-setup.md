# Tableau Server: Konfiguration und Betrieb

Diese Anleitung beschreibt die Einrichtung der Tableau-Server-Integration. Was die Integration tut, ihr Sicherheitsmodell, die Chat-Tools und die HTTP-Endpunkte stehen in [tableau-server.md](tableau-server.md). Sie setzt Tableau Server 2024.2 einschließlich und REST API 3.23 oder höher voraus.

## Voraussetzungen

- SQLite oder PostgreSQL für die Admin-Einstellungen.
- Enterprise-Lizenz mit `tableauServer` und `sso`.
- Funktionierende OIDC-Anmeldung. Der konfigurierte Claim muss exakt dem Tableau-Username entsprechen: `email`, `preferred_username`, `upn` oder ein benutzerdefinierter Claim.
- Der gewählte Claim muss vom IdP administrativ kontrolliert und für die Zielgruppe stabil gepflegt werden. OpenVizPilot verändert weder Domain noch Groß-/Kleinschreibung und verwendet keine Ersatzidentität.
- Je Tableau-**Site** eine eigene Tableau Connected App — entweder **Direct Trust** (Client-ID, Secret-ID,
  Secret-Wert) oder **OAuth 2.0 Trust** (Issuer-URL, JWKS; das Schlüsselpaar erzeugt die Middleware selbst und
  bedient alle Sites gemeinsam). Der JWT-Scope ist in beiden Fällen `tableau:content:read` — nur mit dem Site-Schalter
  „Serverseitige Daten erlauben“ (siehe unten) zusätzlich `tableau:views:download`.
- Für den serverseitigen Datenzugriff (`tableau_view_data`, W5) zusätzlich Enterprise-Lizenz mit `serverData`.
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

## Serverseitiger Datenzugriff aktivieren (W5)

Für `tableau_view_data` (Summary-Daten einer View außerhalb des aktuellen Dashboards) zusätzlich je
Site den Schalter **„Serverseitige Daten erlauben“** aktivieren. Das bewirkt zwei Dinge:

1. Die Connected App dieser Site muss zusätzlich zu `tableau:content:read` den Scope
   `tableau:views:download` erlauben (Direct Trust und OAuth 2.0 Trust gleichermaßen).
2. Der jeweilige Tableau-Nutzer braucht auf der betroffenen View die Tableau-Berechtigung
   **„Zusammenfassungsdaten herunterladen“** — ohne sie schlägt der Lesezugriff serverseitig fehl,
   unabhängig von den übrigen Freigaben.

Zusätzlich nötig, jeweils serverseitig geprüft: Enterprise-Lizenz mit `serverData`, die Freigabe
**„Serverdaten“** je Person unter „Benutzerzugriff“ und die einmalige Einwilligung der Person in der
Extension. Details zu Fehlercodes, Endpunkten und dem Audit-Log stehen in
[tableau-server.md](tableau-server.md#serverseitiger-datenzugriff-w5).

## Suche und Chat

Die Chat-Tools (`tableau_server_search`, `tableau_metadata_search`, `tableau_metadata_field`, `tableau_view_data`), ihre Parameter und die geltenden Such-/Metadaten-Limits stehen in [tableau-server.md](tableau-server.md). Voraussetzung ist die per-Nutzer-Freigabe **Tableau-API** (siehe [user-approvals.md](user-approvals.md)) zusätzlich zu Lizenz, OIDC-Mapping und Site-Zuordnung.

Suchtreffer und Metadaten werden als Tool-Ergebnisse an den konfigurierten LLM-Anbieter übermittelt (Content-Namen, Tags, Owner-/Projektangaben, Quelllinks, Formeln). Das ist bei der Freigabe des Anbieters und seiner Datenverarbeitung zu berücksichtigen. Tableau-Tokens und Connected-App-Secrets werden nicht mitgesendet.

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

Weitere technische Details — Sicherheitsmodell, Chat-Tools, HTTP-Endpunkte, Limits und Mindestversion — stehen in [tableau-server.md](tableau-server.md).
