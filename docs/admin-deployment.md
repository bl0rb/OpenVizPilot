# Deployment auf Tableau Server (Anleitung für Admins)

## Was diese Extension tut — und was nicht

- Die Extension zeigt im Dashboard einen Chat, der Fragen zum geöffneten Dashboard beantwortet. Dafür sendet sie **aggregierte Dashboard-Daten** (das, was der jeweilige User ohnehin sieht) an eine interne Middleware, die sie an einen OpenAI-kompatiblen LLM-Endpunkt (z. B. einen LiteLLM-Proxy) weiterreicht.
- **Datenzugriff ausschließlich in der Session des eingeloggten Users** über die Tableau Extensions API. Row-Level-Security und Benutzerfilter greifen unverändert: Ein User kann per Chat nichts erfragen, was er im Dashboard nicht sieht. Hierarchien (z. B. Geschäftsstellenleiter sieht alle seine Vertriebspartner) werden wie gewohnt per RLS/Entitlement-Tabelle in der Datenquelle modelliert.
- Die Middleware hat **keinen Tableau-Zugang** (kein Service-Account, kein PAT) und loggt nur Metadaten (Modell, Dauer, Tokenzahlen) — nie Inhalte. **Von Dashboard-Daten und Chatverläufen speichert sie nichts**; Fragen und Antworten liegen ausschließlich im Browser des Anwenders. Dauerhaft gespeichert werden dagegen die Betriebsdaten der Anwendung: Anmeldekonten und Sitzungen, Admin-Konto und Einstellungen (inkl. Lizenzschlüssel, OIDC-Client-Secret und — mit `tableauServer`-Lizenz, verschlüsselt mit dem optionalen `OVP_SECRET_KEY`, siehe [tableau-server-setup.md](tableau-server-setup.md) — Tableau-Connected-App-Secrets je Site), die anonyme Nutzungsstatistik und — nur mit Enterprise-Lizenz — persönliche Fakten und gespeicherte Abfragen je Anwender (Details in den Abschnitten weiter unten).
- Die Extension benötigt **keine Full-Data-Berechtigung** (kein `full data` im Manifest): Es werden nur Summary-Daten gelesen, keine Underlying-Rohdaten.
- **Wichtig für die Bewertung:** Die Daten, die ein User im Chat anfragt, verlassen Tableau in Richtung des konfigurierten LLM-Providers (über den angebundenen Endpunkt). Die Provider-/Retention-Governance liegt beim Betrieb dieses Endpunkts.

## Voraussetzungen

1. Ein laufender OpenAI-kompatibler LLM-Endpunkt (z. B. LiteLLM-Proxy) mit API-Key, aus dem Netz der Middleware erreichbar.
2. Ein Host für die Middleware (Node.js ≥ 24 (LTS)) mit HTTPS über einen Reverse Proxy (nginx/IIS) und **CA-signiertem Zertifikat** — self-signed lehnt Tableau Server ab.
3. Row-Level-Security in den betroffenen Datenquellen (Benutzerfilter oder Entitlement-Tabelle), falls Nutzer unterschiedliche Datensichten haben sollen.

## Zugriffsschutz der Middleware (wichtig)

> **Anmeldung in der Extension:** Damit nicht jeder, der die Middleware erreicht, den Chat nutzen kann, gibt es in der Admin-UI (Abschnitt „Anmeldung, Single Sign-On & Lizenz“) den Modus **Benutzerkonten** (Open Core: Konten mit Passwort, vom Admin angelegt) und — mit Enterprise-Lizenz — **Single Sign-On** per OIDC (Microsoft Entra ID, Keycloak); die Middleware verifiziert dann jeden Request gegen den Identity-Provider. Details: [docs/enterprise.md](enterprise.md). Die folgenden Optionen sind die Env-Defaults, die die Admin-UI überschreiben kann.

Die Middleware selbst hat keine Tableau-Anmeldung — jeder, der sie im Netz erreicht, kann über sie kostenpflichtige LLM-Aufrufe auslösen (nicht: fremde Daten lesen — Daten holt nur der Browser des jeweiligen Users). Deshalb **mindestens eine** dieser Maßnahmen:

- **Netzwerkebene**: Erreichbarkeit auf die Browser-Netze der Tableau-Nutzer beschränken (interne Zone, VPN, Reverse-Proxy-ACL).
- **`OVP_API_AUTH_TOKEN`** setzen: Die Middleware verlangt dann `Authorization: Bearer <token>` auf `/api/*`; derselbe Token wird in den Extension-Einstellungen hinterlegt (im Workbook gespeichert — er schützt gegen Netz-Fremde, nicht gegen berechtigte Workbook-Nutzer).

Zusätzlich `OVP_MODEL_ALLOWLIST` setzen, damit Clients nur freigegebene Modelle wählen können.

## Vertrauensmodell Backend-URL

Die Backend-URL der Extension ist ein Workbook-Setting und damit **vom Workbook-Autor kontrolliert** — an sie gehen Fragen und die (RLS-gefilterten) Tool-Daten des jeweiligen Viewers. Die Extension erzwingt HTTPS (bzw. localhost in der Entwicklung) und fällt bei ungültigen URLs auf den eigenen Origin zurück; in Produktion sollte das Feld **leer** bleiben (= gleicher Origin wie die per Safelist freigegebene Extension). Workbooks aus nicht vertrauenswürdigen Quellen sind wie immer ein Risiko — Publishing-Rechte entsprechend steuern.

## Schritt 1: Middleware auf EKS deployen (Helm)

Voraussetzungen im Cluster: Ingress-Controller (z. B. AWS Load Balancer Controller) mit TLS (CA-signiertes Zertifikat, z. B. ACM) und — für das User-Memory — der **CloudNativePG-Operator**.

```bash
helm install openvizpilot oci://ghcr.io/bl0rb/charts/openvizpilot \
  --namespace openvizpilot --create-namespace \
  -f my-values.yaml
```

Wesentliche Values (`charts/openvizpilot/values.yaml` ist vollständig kommentiert):

- `image.edition` (`core` | `enterprise`): wählt das Image-Repository — `core` = `ghcr.io/bl0rb/openvizpilot` (öffentlich), `enterprise` = `ghcr.io/bl0rb/openvizpilot-enterprise` (privates GHCR-Paket, braucht `imagePullSecrets` mit dem Kunden-Lese-Token — ohne das bricht das Rendern kontrolliert ab; siehe [docs/enterprise.md](enterprise.md#bezug-des-enterprise-images)). `image.repository` bleibt dafür leer; explizit gesetzt (z. B. eigene Registry-Spiegelung) hat es Vorrang vor der Ableitung.
- `llm.baseUrl` + `llm.apiKeySecret.existingSecret` (Secret mit dem API-Key des LLM-Endpunkts; Klartext-`llm.apiKey` nur für Dev/CI)
- `app.defaultModel`, `app.modelAllowlist`, `app.authTokenSecret`/`app.authToken` (Zugriffsschutz)
- `memory.enabled` + `memory.database.mode`: `cnpg` (Chart legt einen CloudNativePG-Cluster an, App-Secret `<fullname>-db-app` wird automatisch verdrahtet) oder `external` (eigene Postgres-URI aus Secret). Die Datenbank trägt Admin-Konto, Anmeldung, Befehle, Playbooks und Statistik — sie wird also auch ohne Enterprise-Lizenz gebraucht; `memory.model` = günstiges Modell für die Fakten-Extraktion (nur mit Lizenz-Feature `memory` aktiv)
- Skalierung: `replicaCount` fest setzen ODER `autoscaling.enabled` (HPA, CPU-basiert, min/max) für **horizontale** Skalierung bei vielen Nutzern; `resources` (+ optional `vpa.enabled`, nicht zusammen mit HPA) für vertikale. Die Middleware ist statuslos, SSE-Streams brauchen keine Sticky Sessions; die Memory-Konsistenz (DSGVO-Löschung vs. laufende Extraktion) wird DB-seitig in Postgres erzwungen und ist multi-replica-sicher.
- Anmeldung/Enterprise: `auth.mode` (`none` | `token` | `local` | `oidc`), `app.publicUrl` (öffentliche URL, Pflicht für SSO), `oidc.*` (Provider, Issuer, Client-ID, optional Secret), `license.*` (Lizenz-Secret; der Vertrauensanker ist fest eingebaut) — alles auch zur Laufzeit in der Admin-UI setzbar, Details in [docs/enterprise.md](enterprise.md)
- `app.environment` (`production` | `development` | `test` | `staging`, → `OVP_ENVIRONMENT`): Eine Enterprise-Lizenz erlaubt eine produktive Installation, Dev/Test/Staging sind inklusive. Enterprise-Funktionen laufen erst nach der **Aktivierung** der Installation: sofort beim Start und dann täglich bei `werkworks.de` (ausgehend HTTPS, Port 443 freischalten) — ohne Internetzugang per Offline-Lease über die Admin-UI. Bis dahin laufen nur Core-Funktionen; nach einer Aktivierung schaltet Nichterreichbarkeit 30 Tage nach Lease-Ablauf nichts ab — [docs/enterprise.md](enterprise.md#aktivierung-lease-und-karenz)
- `ingress.host` + TLS; SSE beachten: bei nginx-Ingress für `/api/chat` `proxy_buffering off` (Annotation `nginx.ingress.kubernetes.io/proxy-buffering: "off"`)

Image und Chart werden von den GitHub-Workflows (`.github/workflows/publish-ghcr-*.yml`) bei `v*`-Tags nach `ghcr.io` publiziert; die PR-CI (`pr-ci.yml`) ist dabei das Release-Gate.

Test: `https://chat.example.com/healthz` → `{"ok":true}`; `https://chat.example.com/` → Chat-UI lädt.

<details>
<summary>Alternative ohne Kubernetes (Bare-Metal/VM)</summary>

`npm ci && npm run build`, dann `packages/server/dist/index.js` mit Node ≥ 24 starten (systemd/pm2), Umgebung nach `.env.example`, `OVP_SERVE_STATIC_DIR` auf den Extension-Build zeigen lassen, Reverse Proxy mit HTTPS davor (SSE: `proxy_buffering off;`).
</details>

## User-Memory und eigene Abfragen: Datenschutz & Betrieb

> **Enterprise:** Beides sind Enterprise-Funktionen (Lizenz-Features `memory` und `savedQueries`,
> siehe [docs/enterprise.md](enterprise.md)). Ohne passende Lizenz extrahiert die Middleware keine
> Fakten mehr, ignoriert den Antwortfokus und antwortet auf `/api/memory/prefs` mit `402`; die
> Extension blendet aus, was sie nicht speichern kann. **Auskunft und Löschung bleiben offen:**
> `GET` und `DELETE /api/memory` funktionieren unabhängig von der Lizenz, und das
> Einstellungen-Panel zeigt bereits gespeicherte Fakten samt Löschknopf weiter an — es kommen nur
> keine neuen dazu. Die Datenbank selbst (`memory.enabled` im Chart) bleibt Kernbestandteil: sie
> trägt auch Admin-Konto, Anmeldung, Slash-Befehle, Playbooks und die anonyme Statistik.

- **Was gespeichert wird**: kurze persönliche Fakten pro Nutzer (Name, Rolle, Vorlieben — max. 30, je ≤ 300 Zeichen) in Postgres, geschlüsselt nach der **obfuskierten** `uniqueUserId` der Extensions API. **Keine Dashboard-Daten**: Die Extraktion sieht nur die Chat-Fragen des Nutzers (nie Tool-Ergebnisse), und der Extraktions-Prompt verbietet Kennzahlen/Datenwerte zusätzlich.
- **Transparenz/Löschung (DSGVO)**: Jeder Nutzer sieht seine Fakten im Einstellungen-Panel der Extension und kann sie dort vollständig löschen (`DELETE /api/memory`) — unabhängig davon, ob die Enterprise-Lizenz noch gilt.
- **Vertrauensgrenze**: In den Modi `none` und `token` ist die Nutzer-ID client-asserted (Header/Request-Feld). Innerhalb des per `OVP_API_AUTH_TOKEN`/Netzwerk geschützten Kreises könnte ein technisch versierter Nutzer dann eine fremde ID angeben und deren *Personalisierungs-Fakten* lesen oder löschen — **nicht** deren Dashboard-Daten (die holt weiterhin nur der jeweilige Browser in der eigenen Tableau-Session). In den Modi `local` und `oidc` ersetzt die verifizierte Anmeldung die client-asserted ID für Memory, Präferenzen und Statistik; die Enterprise-Funktionen Memory und gespeicherte Abfragen sind dann an die angemeldete Identität gebunden.
- Backups/Retention der Memory-Datenbank nach euren Datenschutz-Vorgaben konfigurieren (CNPG `backup`-Spec bzw. RDS-Policies).

## Serverseitiger Datenzugriff (Tableau-Views außerhalb des Dashboards)

> **Enterprise:** Lizenz-Feature `serverData`, zusätzlich zu `tableauServer` und `sso` (siehe
> [docs/enterprise.md](enterprise.md)). Grundlage für Watch (siehe unten) und künftige
> Cross-Dashboard-Funktionen.

Das Chat-Tool `tableau_view_data` liest Summary-Daten einer Tableau-View, die **nicht** im gerade
geöffneten Dashboard liegt, serverseitig im Namen des angemeldeten Nutzers und mit dessen
Tableau-Berechtigungen (Connected-App-JWT mit zusätzlichem Scope `tableau:views:download`). Anders
als der übliche clientseitige Zugriff über die Extensions API prüft die Middleware dafür bei jeder
Abfrage drei Hürden:

1. **Site-Schalter** „Serverseitige Daten erlauben“ (Admin → Tableau Server → Site) — sonst bricht die Abfrage mit `server_data_disabled` ab.
2. **Freigabe „Serverdaten“** je Person unter „Benutzerzugriff“ — sonst `server_data_not_granted`.
3. **Einwilligung** der Person (einmalig, über die Extension) — fehlt sie, antwortet die Middleware mit `409 consent_required`.

Details zu Tool, Endpunkten und Scope stehen in [tableau-server.md](tableau-server.md), zur
Site-Einrichtung in [tableau-server-setup.md](tableau-server-setup.md). Gespeichert wird dabei
**nichts** von den gelesenen Daten — nur ein Audit-Eintrag je Abfrage (Zeitpunkt, ein nicht
umkehrbares Pseudonym, Site, View, Zeilenzahl, Dauer, Status), 90 Tage lang, einsehbar im Admin
unter „Tableau Server“. Widerruf: Freigabe „Serverdaten“ abschalten löscht zusätzlich die
gespeicherte Einwilligung — die Person muss danach erneut zustimmen.

Die **umgebungsweite Untersuchung** (Untersuchen-Modus, Umfang „Gesamte Tableau-Umgebung“, W7)
nutzt denselben Pfad und dieselben drei Hürden: das Modell darf dabei höchstens 5 Views pro Turn
lesen, und die Route begrenzt zusätzlich auf höchstens 8 `tableau_view_data`-Aufrufe je Person und
Dashboard innerhalb von 2 Minuten (`429 budget_exhausted`) — ein reiner Schutz vor Endlosschleifen
des Modells, keine weitere Freigabe nötig. Ohne die Freigabe oder die Lizenz wird der Umfang
serverseitig auf „Nur dieses Dashboard“ zurückgestuft; die Extension zeigt dazu einen Hinweis in der
Antwort statt eines eigenen Fehlerdialogs.

## Watch (Dashboards beobachten und melden)

> **Enterprise:** Lizenz-Feature `watch`, zusätzlich zu `serverData`, `tableauServer` und `sso`
> (siehe [docs/enterprise.md](enterprise.md)). Details zu Regeln, Zeitplänen, Kanälen und
> Sicherheit stehen in [docs/watch.md](watch.md).

Watch wertet Regeln nach Zeitplan im Namen des jeweiligen Nutzers aus (derselbe Pfad wie oben:
alle Hürden bei jedem Lauf) und stellt bei einem Übergang in den Alarmzustand eine kurze Meldung
per Webhook, Microsoft Teams oder E-Mail zu. Der globale Schalter ist per Default an
(`OVP_WATCH_ENABLED`, zusätzlich zur Admin-Einstellung „Watch“ → „global an/aus“) und läuft nur
mit Datenbank. Für den E-Mail-Kanal zusätzlich `OVP_SMTP_URL` (z. B.
`smtps://user:pass@mail.example.com:465`) und `OVP_SMTP_FROM` setzen — im Helm-Chart über
`smtp.urlSecret.{existingSecret,key}` und `smtp.from` (siehe Vault-Tabelle im README). Ohne SMTP
bleiben Webhook und Microsoft Teams unverändert nutzbar.

## Schritt 2: Manifest erzeugen und verteilen

**Empfohlener Weg — Download aus der Admin-UI** (kein Checkout nötig; setzt voraus, dass die Middleware die Extension-Statik ausliefert — im Container/Helm-Deployment immer der Fall, lokal nur mit `OVP_SERVE_STATIC_DIR` + gebauter Extension; die Admin-UI warnt sonst): Auf `https://<host>/admin` anmelden (Admin-Passwort bzw. `OVP_ADMIN_TOKEN` — siehe Abschnitt „Admin-UI“), im Abschnitt **„Extension für Tableau“** die öffentliche Extension-URL prüfen (vorbelegt mit dem aktuellen Host) und **„Manifest (.trex) herunterladen“** klicken. Die Middleware validiert die URL (HTTPS-Pflicht; Query/Fragment verboten) und liefert das fertige `openvizpilot.trex`. Da die Extension bei leerer Backend-URL automatisch mit **demselben Origin** spricht, aus dem sie geladen wurde, ist damit auch die Verbindung zur Middleware korrekt konfiguriert — nichts weiter einzutragen.

Alternativ per Build-Script aus dem Repo:

```bash
npm run build:trex -w @openvizpilot/extension -- --url https://chat.example.com/
```

Ergebnis: `packages/extension/dist/openvizpilot.trex` — diese Datei bekommen die Dashboard-Autoren (Extension-Objekt aufs Dashboard ziehen → „Auf meinem Computer“ → .trex wählen). Beide Wege nutzen dieselbe Vorlage (`@openvizpilot/shared/trex.ts`).

## Schritt 3: Safelist auf Tableau Server

1. Serverweit erlauben: **Alle Sites verwalten → Einstellungen → Erweiterungen** → „Benutzern das Ausführen von Erweiterungen erlauben“.
2. Pro Site: **Einstellungen → Erweiterungen → Bestimmte Erweiterungen aktivieren** → URL `https://chat.example.com/` eintragen.
   - **Vollständiger Datenzugriff: nicht erforderlich** (Verweigern genügt — die Extension nutzt nur Summary-Daten).
   - **Benutzeraufforderungen: Anzeigen** empfohlen (Transparenz: Nutzer sehen, dass eine Extension läuft und wohin sie spricht).
3. Netzwerk: Der Extension-Host muss den LLM-Endpunkt erreichen; die Browser der Nutzer müssen `https://chat.example.com` erreichen.

## Admin-UI (Slash-Befehle, Manifest-Download & anonyme Nutzung)

Unter `https://<host>/admin` liegt die Verwaltungsseite. Zwei Betriebsarten:

- **Passwort-Modus (empfohlen, Default mit aktivem User-Memory)**: Ohne gesetztes `OVP_ADMIN_TOKEN` legt der **erste Besucher von `/admin` das Admin-Passwort selbst an** (Ersteinrichtung, mindestens 12 Zeichen — wie in PaddleDoc). Danach: Login mit Passwort, DB-gestützte Sessions (12 h, multi-replica-fähig) und Lockout nach 5 Fehlversuchen (15 Minuten). **Wichtig:** Die Ersteinrichtung direkt nach dem Deploy durchführen — bis dahin kann jeder, der `/admin` erreicht, das Konto beanspruchen (deshalb `/admin` ohnehin netzwerkbeschränken, s. u.). Passwort vergessen? In der Memory-Datenbank `DELETE FROM admin_account; DELETE FROM admin_sessions;` ausführen — dann steht die Ersteinrichtung wieder an.
- **Token-Modus**: Mit gesetztem `OVP_ADMIN_TOKEN` (eigenes Regime, unabhängig vom `OVP_API_AUTH_TOKEN`) gilt das statische Bearer-Token wie bisher; Ersteinrichtung/Login sind dann deaktiviert.

Ohne `OVP_ADMIN_TOKEN` **und** ohne User-Memory existiert die Route nicht (404).

**Rollen.** Token bzw. Admin-Konto sind der **initiale Admin**. Zusätzlich kann er unter „Benutzerzugriff“ einzelnen Identitäten (lokale Konten oder SSO-Identitäten) den Schalter **Admin** geben — diese **delegierten Admins** melden sich an `/admin` mit ihrem eigenen Konto an („Mit Benutzerkonto anmelden“: Benutzername/Passwort im Modus `local`, „Mit Single Sign-On anmelden“ im Modus `oidc`; die Anmeldung folgt dem jeweils aktiven Anmeldemodus). Delegierte Admins bedienen die gesamte Administration, dürfen aber die Admin-Rolle **weder vergeben noch entziehen** (API: `403 initial_admin_required`); gesperrte Konten kommen nicht durch, ein Konto ohne Rolle erhält `403 not_admin`. Ein Entzug der Rolle wirkt beim nächsten Request. `GET /api/admin/me` liefert `{ role: 'initial' | 'delegated', name, provider }`.

- **Slash-Befehle**: Die deutschen Prompt-Playbooks der Extension (`/zusammenfassung` usw.) zentral bearbeiten, ergänzen (max. 20) oder auf die eingebauten Standards zurücksetzen. Die Extension lädt die Befehle beim Start vom Server (Fallback: eingebaute Defaults).
- **Kennzahlen**: Unternehmensweit verbindlicher Kennzahlenkatalog (bis zu 200 Einträge: Name, Synonyme, Definition, Owner, Datenquelle, Interpretationshinweis, bis zu fünf geprüfte Fragen mit Antwortlogik). Der Katalog wird kompakt in den System-Prompt eingebettet; erkennt der Assistent eine Kennzahl oder ein Synonym, schlägt er die Definition per Tool `lookup_metric` nach und die Antwort zeigt „✓ Verifizierte Definition“ — nur dann, wenn das Tool wirklich lief. Ergänzt das Autoren-Glossar im Workbook, das je Dashboard gilt.
- **Standardanalysen pro Dashboard**: Eingebundene Dashboards unabhängig von der Nutzungsstatistik auswählen, bis zu fünf Starter-Fragen und eigene Slash-Befehle hinterlegen. [Einrichtung und Zuordnung](#standardanalysen-pro-dashboard).
- **Modelle**: Welche Modelle die Extension anbietet — per „Vom Endpunkt laden“ die Liste des LLM-Endpunkts abrufen, Einträge übernehmen und mit sprechenden **Anzeigenamen** versehen (z. B. „Standard (empfohlen)“ statt der technischen Modell-ID). Ein gespeicherter Katalog **übersteuert `OVP_MODEL_ALLOWLIST`**: Nur noch seine Modell-IDs sind wählbar — am Chat-Endpunkt erzwungen, auch für Requests ohne `model`-Feld. Enthält der Katalog das konfigurierte `OVP_DEFAULT_MODEL` nicht, gilt sein **erster Eintrag** als Standard-Modell (so kann ein Modell rein über die Admin-UI stillgelegt werden). Ist der Katalog wegen eines DB-Fehlers kurzzeitig nicht lesbar, wird **fail-closed** nur `OVP_MODEL_ALLOWLIST` bzw. das Default-Modell akzeptiert. Ohne Katalog gilt wie bisher die Endpunkt-Liste ∩ `OVP_MODEL_ALLOWLIST`.
- **Extension für Tableau**: Manifest-Download mit validierter HTTPS-URL (siehe „Schritt 2“).
- **Nutzung (anonym)**: Aggregierte Tageszähler — Chat-Turns pro Modell, Tool-Aufrufe pro Tool, verwendete Slash-Befehle, ausgeführte Action-Chips, vom Scope-Guard abgelehnte Fragen (`scope_blocked`), Fehler — **ohne Nutzer-IDs und ohne Frage-/Antwort-Inhalte**. Dazu eine **Dashboard-Tabelle**: Fragen je Dashboard, Anzahl Anwender, Ø und Maximum Fragen je Anwender. „Anwender“ sind dabei **nicht umkehrbare Pseudonyme**: HMAC-SHA256 der obfuskierten Tableau-User-ID mit einem geheimen, pro Installation einmalig erzeugten Salt (DB-Singleton, replikaübergreifend) — es werden weder Namen noch Tableau-IDs gespeichert, und die Pseudonyme verlassen den Server nicht (die Admin-UI sieht nur Zähler). Sie sind bewusst nicht mit dem User-Memory verknüpfbar. Kennzahlen **je Anwender** (Anzahl, Ø, Maximum) werden erst ab **3 Anwendern** je Dashboard ausgewiesen — darunter „< 3“, damit sich eine einzelne Person nicht über die Zähler erraten lässt (die Fragen-Summe je Dashboard bleibt sichtbar; bei Dashboards mit nur einem Nutzer ist diese Summe naturgemäß dessen Nutzung). Gezählt werden nur frische, vom Scope-Guard akzeptierte Fragen — keine Tool-Runden, keine Wiederholungen nach Fehlern, keine abgelehnten Off-Topic-Fragen. Datenschutzrechtlich handelt es sich um pseudonymisierte Nutzungsdaten; bei Bedarf über die Retention der Memory-Datenbank (Tabelle `usage_dashboards`) begrenzen.

`/admin` gehört nicht in die Tableau-Safelist und sollte idealerweise nur aus dem Admin-Netz erreichbar sein (Ingress-/Proxy-Regel).

## Themen-Scope-Guard (LLM-Absicherung)

Zusätzlich zur THEMEN-SCOPE-Regel im System-Prompt prüft die Middleware standardmäßig **vor jedem Haupt-LLM-Call** mit einem günstigen Modell, ob die neueste Nutzerfrage überhaupt Dashboard-Bezug hat (`OVP_SCOPE_GUARD=on`, Default). Off-Topic-Fragen (Allgemeinwissen, Programmieraufgaben, private Themen …) werden mit einer festen Absage beantwortet — **das Hauptmodell wird dafür gar nicht erst aufgerufen**. Das macht die Absicherung zweischichtig: Selbst wenn ein Prompt-Jailbreak die System-Prompt-Regel aushebeln würde, erreicht die Frage das Hauptmodell nicht.

- `OVP_SCOPE_MODEL` (Values: `app.scopeModel`): Modell für die Klassifikation — ein günstiges Modell genügt (Default: `OVP_MEMORY_MODEL` bzw. `OVP_DEFAULT_MODEL`).
- Verhalten bei Guard-Fehlern/Timeouts: **fail-open** (der Chat bleibt verfügbar, die System-Prompt-Regel greift weiterhin); der Vorfall wird geloggt.
- Geprüft wird die **neueste Nutzerfrage bei jedem Request** — auch bei Tool-Runden-Fortsetzungen, denn die Historie kommt vollständig vom Client und eine ungeprüfte „Fortsetzung“ wäre sonst eine triviale Umgehung. Pro Runde fällt ein kleiner Klassifikations-Call an (max. 5 Runden pro Frage). Requests ganz ohne Nutzernachricht lehnt die Middleware bei aktivem Guard mit 400 ab.
- Grenze: **Ältere** Nachrichten der client-gelieferten Historie werden nicht erneut klassifiziert — dort bleibt die THEMEN-SCOPE-Regel des System-Prompts die Verteidigungslinie.
- Abgelehnte Fragen erscheinen in der Admin-Statistik als Metrik `scope_blocked` (nur Zähler, nie Inhalte).
- Abschalten mit `OVP_SCOPE_GUARD=off` (Values: `app.scopeGuard: false`) — z. B. wenn Latenz/Kosten des Zusatz-Calls nicht gewünscht sind.

## Betrieb

- Logs der Middleware enthalten nur Metadaten; Log-Level über `OVP_LOG_LEVEL`.
- Modell-Angebot für Nutzer über den **Modell-Katalog der Admin-UI** steuern (empfohlen: sprechende Anzeigenamen) oder über `OVP_MODEL_ALLOWLIST` einschränken; der Katalog übersteuert die Allowlist. Leer (beides) = alles, was der Endpunkt meldet.
- Updates: `helm upgrade … --version <neu> --reuse-values` — die .trex-URL bleibt stabil, am Safelist-Eintrag ändert sich nichts.

## Umbenannte Variablen

Alle Konfigurations-Env-Variablen der Middleware wurden auf das `OVP_`-Schema vereinheitlicht.
**Die alten Namen funktionieren weiter** (Fallback in `packages/server/src/env.ts`) — beim Start
erscheint dafür einmalig eine Warnung im Log, welche veralteten Namen noch verwendet werden. Sind
alter und neuer Name gleichzeitig gesetzt, gewinnt der neue.

| Alt | Neu |
| --- | --- |
| `LITELLM_BASE_URL` | `OVP_LLM_BASE_URL` |
| `LITELLM_API_KEY` | `OVP_LLM_API_KEY` |
| `DEFAULT_MODEL` | `OVP_DEFAULT_MODEL` |
| `MODEL_ALLOWLIST` | `OVP_MODEL_ALLOWLIST` |
| `ALLOWED_ORIGINS` | `OVP_ALLOWED_ORIGINS` |
| `SERVE_STATIC_DIR` | `OVP_SERVE_STATIC_DIR` |
| `API_AUTH_TOKEN` | `OVP_API_AUTH_TOKEN` |
| `ADMIN_TOKEN` | `OVP_ADMIN_TOKEN` |
| `MEMORY_DATABASE_URL` | `OVP_DATABASE_URL` |
| `MEMORY_DB_PATH` | `OVP_DATABASE_PATH` |
| `MEMORY_MODEL` | `OVP_MEMORY_MODEL` |
| `SCOPE_GUARD` | `OVP_SCOPE_GUARD` |
| `SCOPE_MODEL` | `OVP_SCOPE_MODEL` |
| `LOG_LEVEL` | `OVP_LOG_LEVEL` |
| `AUTH_MODE` | `OVP_AUTH_MODE` |
| `PUBLIC_URL` | `OVP_PUBLIC_URL` |
| `OIDC_PROVIDER` / `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_SCOPES` | `OVP_OIDC_PROVIDER` / `OVP_OIDC_ISSUER` / `OVP_OIDC_CLIENT_ID` / `OVP_OIDC_CLIENT_SECRET` / `OVP_OIDC_SCOPES` |
| `APP_VERSION` | `OVP_APP_VERSION` |
| `PORT` | bleibt `PORT` (Plattform-Konvention); zusätzlich als `OVP_PORT` überschreibbar |
| `MOCK_LLM_PORT` / `MOCK_OIDC_PORT` / `CLAUDE_LLM_PORT` (Dev-Skripte) | `OVP_MOCK_LLM_PORT` / `OVP_MOCK_OIDC_PORT` / `OVP_CLAUDE_LLM_PORT` |

Das Helm-Chart (`charts/openvizpilot`) kennt nur noch die neuen Namen; `litellm.*` in `values.yaml`
wurde zu `llm.*` und schlägt beim Rendern mit einer Fehlermeldung fehl, wenn noch alte Werte gesetzt sind.

## Go-Live-Checkliste

**Registry & Deployment**

- [ ] **GHCR-Zugriff geklärt**: Image (`ghcr.io/bl0rb/openvizpilot`) und Chart (`ghcr.io/bl0rb/charts/openvizpilot`) sind nach dem Publish **privat** (GitHub-Default). Entweder in den GitHub-Package-Settings auf *public* stellen, oder im Cluster ein `imagePullSecret` hinterlegen (Values: `imagePullSecrets`) und beim Installieren `helm registry login ghcr.io` verwenden.
- [ ] Release-Version gepinnt installiert (`--version x.y.z`, nicht `latest`).
- [ ] Secrets als `existingSecret` (LLM-Endpunkt-Key; `OVP_API_AUTH_TOKEN` gesetzt oder Zugriff per NetworkPolicy/Ingress beschränkt — siehe „Zugriffsschutz").
- [ ] `OVP_MODEL_ALLOWLIST` und `app.defaultModel` gesetzt; `memory.model` und `app.scopeModel` auf ein günstiges Modell.
- [ ] Admin-Zugang geklärt: entweder `app.adminTokenSecret` gesetzt (Token-Modus) **oder** die Ersteinrichtung im Passwort-Modus **sofort nach dem Deploy** durchgeführt — und `/admin` per Ingress-/Netzwerkregel auf Admins beschränkt.
- [ ] Ingress mit CA-signiertem TLS-Zertifikat; SSE-Buffering für `/api/chat` deaktiviert (nginx: `proxy-buffering: "off"`).
- [ ] CloudNativePG: Storage-Größe passend, **Backups/Retention** konfiguriert (CNPG `backup`-Spec).
- [ ] `https://<host>/healthz` und `/api/models` liefern korrekte Antworten.

**Tableau**

- [ ] Prod-Manifest mit finaler URL erzeugt (`npm run build:trex -- --url https://<host>/`) und an Dashboard-Autoren verteilt.
- [ ] Safelist-Eintrag der Site gesetzt (Full Data: **nicht erforderlich**; Benutzeraufforderungen: **Anzeigen**).
- [ ] **RLS-Isolationstest** nach [testing.md](testing.md) §4 durchgeführt (VP A sieht keine Daten von VP B; GSL sieht seine VPs) — Pflicht vor Rollout.
- [ ] Funktionstest im Zielsystem: Frage mit Tool-Aufruf, Aggregations-Drilldown, Action-Chip (Filter per Klick); mit Enterprise-Lizenz zusätzlich Memory-Anzeige/-Löschung und gespeicherte Standardfragen im Einstellungen-Panel (`GET /api/features` zeigt, was freigeschaltet ist).

**Governance**

- [ ] Zero-Retention/Datenschutz mit dem LLM-Provider hinter dem angebundenen Endpunkt geklärt und intern dokumentiert.
- [ ] Nutzer-Info verteilt: Was die Extension sendet (sichtbare Dashboard-Daten an das interne LLM), was das User-Memory speichert (nur mit Enterprise-Lizenz) und wie man es löscht.
- [ ] Der lokale Claude-CLI-Shim (`dev:claude`) ist **nur für die Entwicklung** — in Produktion läuft ausschließlich der konfigurierte OpenAI-kompatible Endpunkt.


## Standardanalysen pro Dashboard

1. Extension in Tableau im Bearbeitungsmodus einbinden und das Workbook speichern. Dabei erhält die Extension eine dauerhafte Zuordnung in ihren Tableau-Einstellungen; alle Viewer verwenden dieselbe Kennung.
2. Nach der Anmeldung meldet die Extension Kennung und Dashboard-Name an die Middleware. Eine erste Frage ist nicht nötig. Voraussetzung ist die konfigurierte SQLite- oder Postgres-Datenbank.
3. Im Adminportal unter **Standardanalysen pro Dashboard** auf **Dashboards aktualisieren** klicken, das Dashboard auswählen und bis zu fünf Starter-Fragen sowie optional eigene Slash-Befehle speichern.
4. Offene, sichtbare Extensions laden Änderungen innerhalb einer Minute. Gleichnamige Dashboard-Befehle ersetzen den globalen Befehl nur für diese Zuordnung. Nach dem Löschen des Playbooks gelten wieder die globalen Befehle und generischen Vorschläge.

Die Kennung gehört zur Extension-Instanz im Workbook, nicht zum Anwender. Frisch eingebundene Instanzen erhalten unterschiedliche Kennungen, auch bei identischen Dashboard-Namen. Im Adminportal zeigt ein kurzer Kennungszusatz die Unterscheidung. Die Registrierung enthält keine Kennzahlen, Filterwerte, Chatfragen oder Benutzernamen. Sie ist eine Konfigurationszuordnung und kein Nachweis einer Tableau-Berechtigung; fachliche Daten werden weiterhin in der Viewer-Session gelesen. In Vorlagen keine vertraulichen Datenwerte hinterlegen.

**Kopierte Workbooks:** Tableau kopiert auch Extension-Einstellungen. Die Kopie verwendet daher zunächst dieselben Standardanalysen. Für getrennte Analysen in den Extension-Einstellungen **Neue Zuordnung für eine Dashboard-Kopie** wählen (Bearbeitungsmodus) und das Workbook speichern. Ohne gespeicherte Kennung im Viewer-Modus stehen globale Befehle zur Verfügung; die Einstellungen erläutern die nötige Ersteinrichtung.

Bisherige Playbooks mit einem Dashboard-Namen als Schlüssel bleiben im Adminportal als bisherige Zuordnungen erhalten. Neue registrierte Instanzen übernehmen sie bewusst nicht automatisch anhand des Namens, weil gleichnamige Dashboards unterschiedliche Analysen benötigen können. Gewünschte Fragen und Befehle in die neue Zuordnung übertragen. Admin-Analysen stehen auch ohne Enterprise-Lizenz zur Verfügung; persönliche gespeicherte Abfragen bleiben Enterprise.
