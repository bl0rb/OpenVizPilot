# Enterprise Edition: Single Sign-On, Personalisierung & Lizenz

OpenVizPilot ist **source-available**, nicht Open Source: Der Kern (alles außerhalb von `ee/`) steht
unter PolyForm Noncommercial — frei für nicht-kommerzielle Zwecke, jede kommerzielle Nutzung braucht
eine Vereinbarung. Er läuft ohne Lizenzschlüssel. Die **Enterprise Edition** (`ee/`, proprietäre Lizenz) wird über einen
signierten Lizenzschlüssel freigeschaltet und umfasst:

| Feature-Schlüssel | Was er freischaltet |
|---|---|
| `sso` | Single Sign-On per OIDC (Microsoft Entra ID, Keycloak) |
| `memory` | User-Memory: persönliche Fakten personalisieren die Antworten (`GET`/`DELETE /api/memory`) |
| `savedQueries` | Eigene Abfragen speichern: Antwortfokus und Standardfragen je Dashboard (`/api/memory/prefs`) |
| `mcp` | MCP-Quellen und Websuche mit zentraler Admin-Verwaltung und Site-Freigaben |
| `actions` | Dashboard-Aktionen aus dem Chat: Filter setzen/zurücksetzen, Parameter ändern, Marks markieren, Bereiche ein-/ausblenden |
| `tableauServer` | Tableau-Server-Konfiguration, persönlicher Connected-App-Sign-in, Workbook-/View-Suche und Metadata-API (Feldsuche/-detail); benötigt OIDC und `sso`. |

Eine Lizenz kann alle oder einzelne davon enthalten (Feld `features`; fehlt es, gilt der volle
Umfang des Tiers). Ohne passende Lizenz läuft der Kern unverändert weiter — die Extension blendet
aus, was sie nicht speichern kann, `/api/memory/prefs` antwortet mit `402 license_required`, und der
Antwortfokus wird serverseitig ignoriert (die Prüfung sitzt im Chat-Endpunkt, nicht in der
Extension). Ohne `actions` weiß das Modell nichts von der Aktionssyntax (System-Prompt-Abschnitt
entfällt) und die Extension verwirft eine dennoch auftauchende Aktionsliste zusätzlich clientseitig —
es entstehen weder Vorschlags-Chips noch eine Ausführung. Lizenzpflichtig ist das **Erzeugen** von Fakten: `GET` und `DELETE /api/memory` bleiben
immer offen, damit Auskunft und Löschung (DSGVO Art. 15/17) nie an einem Lizenzschlüssel hängen —
läuft eine Lizenz aus, bleiben bereits gespeicherte Fakten im Panel sichtbar und löschbar, es kommen
nur keine neuen hinzu. Welche Features gerade aktiv sind, sagt `GET /api/features`.

## Warum SSO?

Die **Tableau Server Integration** mit Feature-Schlüssel `tableauServer` ist für Tableau Server
ab **2024.2 einschließlich** vorgesehen: persönlicher Connected-App-Sign-in, REST-basierte
Workbook-/View-Suche und Metadata-API mit Feldsuche/-detail. Sie setzt OIDC mit `sso` und je
Tableau-**Site** eine eigene Connected App voraus — unterstützt werden beide Tableau-Trust-Arten: Direct
Trust (Client-ID/Secret, Secret optional verschlüsselt im Web statt nur per Env, siehe `OVP_SECRET_KEY`) und
OAuth 2.0 Trust (ein gemeinsamer, middleware-eigener External-Authorization-Server-Schlüssel für alle Sites,
ohne Shared Secret aus Tableau). Mehrere Sites lassen sich Dashboards einzeln zuordnen; mit nur einer Site ist
keine Zuordnung nötig. `/api/features` zeigt die Lizenzfreigabe; die Integration bleibt bis zur
Admin-Aktivierung aus. Details: [Einrichtung](tableau-server-setup.md) und
[Referenz](tableau-server.md) (Sicherheitsmodell, Connected-App-Modi, Chat-Tools).

MCP wird unter **MCP & Sites (Enterprise)** in der Admin-UI eingerichtet. Es benötigt
persönliche Anmeldung, explizite Site-Mitgliedschaften und eine eigene `mcp`-Freigabe.
Einrichtung, Secret-Referenzen und Grenzen der Site-Zuordnung: [MCP-Dokumentation](mcp.md).

Ohne Anmeldung kann jeder, der die Middleware im Netz erreicht, `/api/chat` aufrufen — mit
`OVP_API_AUTH_TOKEN` schützt nur ein geteiltes Geheimnis, das im Workbook liegt. Im OIDC-Modus meldet
sich **jeder Anwender in der Extension** mit seinem Firmenkonto an; die Middleware verifiziert das
ID-Token des Identity-Providers bei jedem Request und nutzt dessen `sub` als vertrauenswürdige
Nutzer-ID für Memory, Präferenzen und Statistik (statt der client-asserted Tableau-ID).

## Ablauf

1. Die Extension fragt `GET /api/auth/config` → Modus `oidc`, Authorization-Endpunkt, `client_id`, Redirect-URI.
2. Klick auf **„Mit … anmelden"** öffnet ein Popup zum IdP (Authorization Code + PKCE).
3. Der IdP leitet auf `https://<middleware>/auth/callback` um; diese Seite reicht `code`/`state` per
   `postMessage` an die Extension zurück und schließt sich.
4. Die Extension tauscht den Code über `POST /api/auth/exchange` (Backend-for-Frontend) — die
   Middleware ruft den Token-Endpunkt auf (Client-Secret bleibt serverseitig) und verifiziert das ID-Token.
5. Die Extension sendet das ID-Token als `Authorization: Bearer …` bei allen API-Aufrufen; nach Ablauf
   (typisch 1 h) erscheint der Login erneut.

## Einrichtung über die Admin-UI (empfohlen)

Alles Folgende lässt sich ohne Redeploy in der Admin-UI (`/admin`) im Abschnitt
**„Anmeldung, Single Sign-On & Lizenz“** pflegen: Anmeldemodus, Identity-Provider (Entra ID /
Keycloak / generisch) mit Issuer, Client-ID, optionalem Client-Secret und Scopes sowie der
Lizenzschlüssel. „Prüfen & speichern“ verifiziert die Lizenzsignatur und lehnt Single Sign-On ohne
gültige SSO-Lizenz ab; gespeicherte Werte gelten sofort für alle Replicas und überschreiben die
Env-Defaults (`OVP_AUTH_MODE`, `OVP_OIDC_*`, `OVP_LICENSE`). Secrets und Token werden nie zurückgegeben,
nur als „vorhanden“ angezeigt.

Für die Core-Edition gibt es daneben den Modus **„Benutzerkonten“**: Der Admin legt im Abschnitt
**„Benutzerkonten (Core-Edition)“** Konten mit Passwort an, die Anwender melden sich damit in der
Extension an (Sitzungs-Token, 12 h, Lockout nach 5 Fehlversuchen). Das ist der Weg ohne Lizenz.

## Voraussetzungen

- Enterprise-Lizenz mit Feature `sso` (siehe unten).
- Die Middleware liefert die Extension aus (Same-Origin) und ist per HTTPS unter einer festen URL erreichbar.
  Diese **öffentliche URL** muss bekannt sein (Feld in der Admin-UI oder `OVP_PUBLIC_URL`): Aus ihr entsteht die
  Redirect-URI `<URL>/auth/callback`; sie wird bewusst nie aus dem Host-Header eines Requests abgeleitet.
  Ohne sie bleibt SSO blockiert.
- Tableau: Popups aus der Extension müssen erlaubt sein (Standard in Tableau Server/Cloud und Desktop).

## Microsoft Entra ID

1. **App-Registrierung** anlegen (Entra Admin Center → App registrations → New registration).
2. Plattform **Single-page application** (public client, PKCE) mit Redirect-URI
   `https://<middleware>/auth/callback`. Alternativ **Web** + Client-Secret (confidential client) —
   dann `OVP_OIDC_CLIENT_SECRET` setzen.
3. Unter *Token configuration* optional die Claims `email` und `name` ergänzen (für die Anzeige).
4. Werte:

```env
OVP_AUTH_MODE=oidc
OVP_OIDC_PROVIDER=entra
OVP_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OVP_OIDC_CLIENT_ID=<application-(client)-id>
OVP_OIDC_SCOPES=openid profile email
OVP_PUBLIC_URL=https://<middleware>
```

Der Issuer muss exakt dem `iss` der v2.0-Tokens entsprechen (Tenant-ID, Suffix `/v2.0`).

## Keycloak

1. Im Realm einen **Client** anlegen: Client type *OpenID Connect*, *Standard flow* an,
   *Client authentication* aus (public client + PKCE) — oder an, dann `OVP_OIDC_CLIENT_SECRET` setzen.
2. *Valid redirect URIs*: `https://<middleware>/auth/callback`; *Web origins*: `https://<middleware>`.
3. Unter *Advanced* → *Proof Key for Code Exchange Code Challenge Method*: `S256`.
4. Werte:

```env
OVP_AUTH_MODE=oidc
OVP_OIDC_PROVIDER=keycloak
OVP_OIDC_ISSUER=https://<keycloak>/realms/<realm>
OVP_OIDC_CLIENT_ID=<client-id>
OVP_OIDC_SCOPES=openid profile email
OVP_PUBLIC_URL=https://<middleware>
```

## Voraussetzung für Personalisierung

`memory` und `savedQueries` identifizieren den Anwender über `uniqueUserId` der Extensions API
(ab 1.11) und brauchen deshalb **Tableau 2023.2 oder neuer**. Das Manifest lässt bewusst ab 1.10 zu,
damit der Core-Betrieb auf älteren Servern möglich bleibt; dort erscheinen die persönlichen Bereiche
mit einem Hinweis statt stillschweigend zu fehlen. Single Sign-On ist davon nicht betroffen.

## Lizenzschlüssel

Format und Signatur entsprechen dem bestehenden WerkWorks-Lizenzgenerator (Ed25519, siehe
[ee/README.md](../ee/README.md)). Konfiguration:

```env
OVP_LICENSE=<token>       # oder OVP_LICENSE_PATH=/run/secrets/openvizpilot-license
```

Der Vertrauensanker (Ed25519-Public-Key des Lizenzgenerators) ist fest im Produkt eingebaut
(`TRUSTED_LICENSE_KEYS` in `ee/server/src/license.ts`) — dafür gibt es keine Umgebungsvariable mehr.
Rotation braucht einen Release, nie eine Konfigurationsänderung: sonst könnte sich ein Betreiber mit
eigenem Schlüsselpaar selbst Lizenzen ausstellen.

Ohne gültige Lizenz mit Feature `sso` startet die Middleware im OIDC-Modus **nicht** (klare Fehlermeldung);
abgelaufene Lizenzen deaktivieren die Enterprise-Funktionen. Nach `validUntil` bleiben die
Enterprise-Funktionen noch **7 Tage** aktiv (Subscription-Karenz, Warnbanner in der Admin-UI) und
schalten erst danach ab — unabhängig von der separaten 30-Tage-Lease-Karenz unten. Der Status ist in
der Admin-UI unter „Anmeldung, Single Sign-On & Lizenz“ sichtbar.

Für Entwicklung und Tests: `npm run sign-license -w @openvizpilot/ee -- keygen ./keys` erzeugt ein
Schlüsselpaar, `… -- sign ./keys/private.pem "Firma GmbH" 2027-12-31` einen Token.

## Aktivierung, Lease und Karenz

Eine lizenzierte Installation meldet sich einmal täglich bei WerkWorks — Umfang,
Verhalten und der Text für Vertrag und Lizenzdokument stehen in
[ee/telemetry/README.md](../ee/telemetry/README.md). Seit L1 ist dieser Heartbeat
zugleich die **Aktivierung**: Die Installation (dauerhafte Installation-ID aus der
Datenbank) erhält eine signierte **Lease** über 7 Tage, die der Heartbeat alle
24 Stunden erneuert. Enterprise-Funktionen sind aktiv, wenn die Lizenz gültig ist
**und** die Installation eine Lease hat (aktiv oder in Karenz). Der erste Heartbeat
läuft sofort beim Start; ein neu eingetragener Lizenzschlüssel und „Jetzt
aktualisieren“ in der Admin-UI lösen ihn ebenfalls sofort aus — eine online
erreichbare Installation ist binnen Sekunden aktiviert.

Zustände (Lizenzkarte in der Admin-UI):

- **Ausstehend** — diese Installation hatte **noch nie** eine Lease (frisch
  installiert oder gerade auf diese Version aktualisiert): es laufen nur die
  Core-Funktionen, bis die erste Aktivierung gelingt — online über den Heartbeat
  (ausgehend HTTPS auf `werkworks.de`, Port 443) oder per Offline-Lease (unten).
  Die Admin-UI zeigt in diesem Zustand einen deutlichen Hinweis mit beiden Wegen.
- **Aktiv bis …** / **Offline-Lease bis …** — gültige Lease.
- **Grace bis …** — es gab eine Lease, sie ist abgelaufen und konnte nicht erneuert
  werden, der Ablauf liegt weniger als **30 Tage** zurück. Enterprise bleibt an:
  Nichterreichbarkeit von werkworks.de schaltet innerhalb von 30 Tagen nach
  Lease-Ablauf nichts ab.
- **Blockiert** — WerkWorks hat ein Aktivierungslimit gemeldet (mehr produktive
  Installationen als lizenziert) und es gibt keine gültige Lease: nur Core. Eine
  bestehende Installation stilllegen oder übertragen (siehe unten — sofort frei,
  kein Ticket nötig; nach 14 Tagen ohne Heartbeat gilt eine Installation ohnehin
  als frei) oder die Lizenz erweitern. Eine noch gültige Lease wird durch das
  Limit nie ungültig.
- **Abgelaufen** — Karenz vorbei: nur Core, bis der nächste Heartbeat gelingt oder
  eine Offline-Lease eingespielt wird.

Lease-Signaturen prüft das Produkt gegen einen eigenen eingebauten Schlüssel
(`TRUSTED_LEASE_KEYS` in `ee/server/src/license.ts`); eine Lease gilt nur für die
Installation-ID und Lizenz-ID, für die sie ausgestellt wurde, und erweitert nie die
Features der Lizenz.

### Stilllegen und Übertragen

Auf der Lizenzkarte listet „Installationen dieser Lizenz“ die aktiven
Installationen derselben Lizenz (aus der Antwort des letzten Heartbeats, nie
gespeichert). Ein Admin kann seine eigene Installation stilllegen (Button
„Diese Installation stilllegen“, Bestätigung nötig — Platz wird sofort frei) oder
im DR-/Migrationsfall von der neuen Installation aus eine andere Installation
derselben Lizenz übernehmen („Diese Installation ersetzen“ in deren Zeile): Die
Zielinstallation wird stillgelegt, die eigene im selben Zug aktiviert. Nachweis
ist der Lizenz-Token, den auch der Heartbeat sendet — kein zusätzliches Login
nötig. Die stillgelegte Seite sieht das beim nächsten eigenen Heartbeat
(„blockiert“, wer sie ersetzt hat) und kann sich, wenn wieder Platz ist, mit
einem normalen Heartbeat neu aktivieren. Eine selbst stillgelegte Installation
sendet dagegen keine automatischen Heartbeats mehr — sie bleibt stillgelegt, bis
ein Admin „Jetzt aktualisieren“ auslöst. Beide Aktionen sind **nur dem
initialen Admin** vorbehalten (Admin-Token bzw. Admin-Konto; delegierte Admins
erhalten `403 initial_admin_required`) — Routen `POST
/api/admin/license/{deactivate,transfer}`, Body `{ confirm: true }` bzw.
`{ installationId }`; `GET /api/admin/license/installations` (löst denselben
Heartbeat aus) dürfen alle Admins lesen.

### Umgebungen

`OVP_ENVIRONMENT` (Helm `app.environment`) ∈ `production | development | test |
staging`, Default `production`. Eine Lizenz erlaubt **eine produktive**
Installation; Entwicklung, Test und Staging sind inklusive (Lizenz-Payload
`environments`, Default `{ production: 1, nonProduction: unlimited }`). WerkWorks
zählt je Lizenz die in den letzten 14 Tagen aktiven Installationen.

### Offline-Aktivierung

Für Installationen ohne Zugang zu werkworks.de: In der Admin-UI unter
„Offline-Aktivierung“ die **Aktivierungsanfrage** (`ovp-activation-request.json`
mit Installation-ID, Lizenz-ID, Version, Umgebung) herunterladen und an WerkWorks
senden. Zurück kommt eine mit dem Lease-Schlüssel signierte Offline-Lease (bis zu
365 Tage), die im Feld „Lease einfügen“ gespeichert wird (`PUT
/api/admin/license/lease`) — damit ist die Installation aktiviert. Der Heartbeat
läuft weiter und ersetzt sie nur durch eine Lease mit späterem Ablauf. Rechtzeitig
vor Ablauf eine neue Offline-Lease anfordern; nach dem Ablauf gilt die 30-Tage-Karenz.

Alternativ ohne WerkWorks-Handarbeit: Dieselbe Anfrage-Datei direkt unter
`https://werkworks.de/ovp-lizenz/offline.php` einreichen (Lizenz-Token
bereithalten, gültig min(365 Tage, Lizenzablauf)) — die Lease kommt sofort als
Download zurück. Offline-Installationen senden keine Heartbeats und belegen
ihren Platz bis zum Lease-Ablauf.

## Helm

```yaml
auth:
  mode: oidc
oidc:
  provider: entra                # oder keycloak
  issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
  clientId: <client-id>
  clientSecretSecret:            # nur confidential clients
    existingSecret: openvizpilot-oidc
    key: OVP_OIDC_CLIENT_SECRET
license:
  existingSecret: openvizpilot-license   # Key OVP_LICENSE
app:
  publicUrl: https://chat.example.com
  environment: production                # development | test | staging zählen nicht gegen die Lizenz
```

## Bezug des Enterprise-Images

Das Enterprise-Image (`ghcr.io/bl0rb/openvizpilot-enterprise`, cosign-signiert und mit SBOM wie das
Core-Image) ist ein **privates** GHCR-Paket, gebaut aus dem privaten Repository. WerkWorks vergibt dafür
ein Kunden-Lese-Token — GHCR-Paketzugriff wird **je Paket** vergeben, das Token ist also auf
`openvizpilot-enterprise` beschränkt (Fine-grained PAT mit `read:packages`). Zum Erhalt: info@werkworks.de.

Mit dem Token im Cluster ein Image-Pull-Secret anlegen:

```bash
kubectl create secret docker-registry openvizpilot-enterprise-pull \
  --docker-server=ghcr.io \
  --docker-username=<beliebig, z. B. der Firmenname> \
  --docker-password=<Kunden-Lese-Token> \
  --namespace openvizpilot
```

und im Chart referenzieren:

```yaml
image:
  edition: enterprise
imagePullSecrets:
  - name: openvizpilot-enterprise-pull
```

`image.repository` bleibt dabei leer — es wird aus `image.edition` abgeleitet
(`ghcr.io/bl0rb/openvizpilot-enterprise`); ein explizit gesetzter Wert (z. B. eigene
Registry-Spiegelung) hat Vorrang. Ohne `imagePullSecrets` bricht das Rendern mit
`image.edition: enterprise` kontrolliert ab: „Enterprise-Image ist privat: imagePullSecrets mit dem
WerkWorks-Registry-Token setzen“.

**Source-Review:** Der vollständige Quellcode der Enterprise Edition liegt in einem privaten
Repository (`ee/` in diesem — öffentlichen — Repository ist nur ein funktionsloser Stub mit
identischer API-Oberfläche). Kunden erhalten nach Vertrag/NDA Einsicht in das private Repository zur
Prüfung; Anfragen ebenfalls an info@werkworks.de.

## Lizenzen ausstellen (WerkWorks)

Lizenzen stellt der WerkWorks-Lizenzgenerator direkt aus (Format, Vertrauensanker und
Upgrade-Hinweis für ältere Lizenzen: [ee/README.md](../ee/README.md)):

```bash
certfleet-license generate --product openvizpilot \
  --licensee "Beispiel GmbH" --tier enterprise --days 365 \
  --out beispiel.openvizpilot-license
```

Ohne `--features` enthält die Lizenz alle Enterprise-Funktionen des Tiers; für einen kleineren
Umfang `--features sso,memory` o. ä. angeben (auch über die Weboberfläche des Generators möglich).
`GET /api/features` zeigt, was gerade aktiv ist.

## Lokal ausprobieren

`npm run dev:demo:sso` startet zusätzlich einen Mock-Identity-Provider (Port 4030, Auto-Login als
„Anna Beispiel“). Dazu in der `.env`: `OVP_AUTH_MODE=oidc`, `OVP_OIDC_PROVIDER=generic`,
`OVP_OIDC_ISSUER=http://127.0.0.1:4030`, `OVP_OIDC_CLIENT_ID=openvizpilot-dev`, `OVP_PUBLIC_URL=http://localhost:3000`
sowie eine Dev-Lizenz (siehe oben) — alternativ alles in der Admin-UI eintragen. `OVP_PUBLIC_URL` muss auf
die **Middleware** zeigen, nicht auf den Vite-Dev-Server: Die Redirect-URI `<OVP_PUBLIC_URL>/auth/callback`
wird von der Middleware ausgeliefert (Port 3000).
