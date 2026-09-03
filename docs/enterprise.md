# Enterprise Edition: Single Sign-On, Personalisierung & Lizenz

OpenVizPilot ist **Open Core**: Der Kern (alles außerhalb von `ee/`) steht unter PolyForm Noncommercial
und läuft ohne Lizenzschlüssel. Die **Enterprise Edition** (`ee/`, proprietäre Lizenz) wird über einen
signierten Lizenzschlüssel freigeschaltet und umfasst:

| Feature-Schlüssel | Was er freischaltet |
|---|---|
| `sso` | Single Sign-On per OIDC (Microsoft Entra ID, Keycloak) |
| `memory` | User-Memory: persönliche Fakten personalisieren die Antworten (`GET`/`DELETE /api/memory`) |
| `savedQueries` | Eigene Abfragen speichern: Antwortfokus und Standardfragen je Dashboard (`/api/memory/prefs`) |

Eine Lizenz kann alle oder einzelne davon enthalten (Feld `features`; fehlt es, gilt der volle
Umfang des Tiers). Ohne passende Lizenz läuft der Kern unverändert weiter — die Extension blendet
aus, was sie nicht speichern kann, `/api/memory/prefs` antwortet mit `402 license_required`, und der
Antwortfokus wird serverseitig ignoriert (die Prüfung sitzt im Chat-Endpunkt, nicht in der
Extension). Lizenzpflichtig ist das **Erzeugen** von Fakten: `GET` und `DELETE /api/memory` bleiben
immer offen, damit Auskunft und Löschung (DSGVO Art. 15/17) nie an einem Lizenzschlüssel hängen —
läuft eine Lizenz aus, bleiben bereits gespeicherte Fakten im Panel sichtbar und löschbar, es kommen
nur keine neuen hinzu. Welche Features gerade aktiv sind, sagt `GET /api/features`.

## Warum SSO?

Ohne Anmeldung kann jeder, der die Middleware im Netz erreicht, `/api/chat` aufrufen — mit
`API_AUTH_TOKEN` schützt nur ein geteiltes Geheimnis, das im Workbook liegt. Im OIDC-Modus meldet
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
Env-Defaults (`AUTH_MODE`, `OIDC_*`, `OVP_LICENSE`). Secrets und Token werden nie zurückgegeben,
nur als „vorhanden“ angezeigt.

Für die Open-Core-Edition gibt es daneben den Modus **„Benutzerkonten“**: Der Admin legt im Abschnitt
**„Benutzerkonten (Open Core)“** Konten mit Passwort an, die Anwender melden sich damit in der
Extension an (Sitzungs-Token, 12 h, Lockout nach 5 Fehlversuchen). Das ist der Weg ohne Lizenz.

## Voraussetzungen

- Enterprise-Lizenz mit Feature `sso` (siehe unten).
- Die Middleware liefert die Extension aus (Same-Origin) und ist per HTTPS unter einer festen URL erreichbar.
  Diese **öffentliche URL** muss bekannt sein (Feld in der Admin-UI oder `PUBLIC_URL`): Aus ihr entsteht die
  Redirect-URI `<URL>/auth/callback`; sie wird bewusst nie aus dem Host-Header eines Requests abgeleitet.
  Ohne sie bleibt SSO blockiert.
- Tableau: Popups aus der Extension müssen erlaubt sein (Standard in Tableau Server/Cloud und Desktop).

## Microsoft Entra ID

1. **App-Registrierung** anlegen (Entra Admin Center → App registrations → New registration).
2. Plattform **Single-page application** (public client, PKCE) mit Redirect-URI
   `https://<middleware>/auth/callback`. Alternativ **Web** + Client-Secret (confidential client) —
   dann `OIDC_CLIENT_SECRET` setzen.
3. Unter *Token configuration* optional die Claims `email` und `name` ergänzen (für die Anzeige).
4. Werte:

```env
AUTH_MODE=oidc
OIDC_PROVIDER=entra
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application-(client)-id>
OIDC_SCOPES=openid profile email
PUBLIC_URL=https://<middleware>
```

Der Issuer muss exakt dem `iss` der v2.0-Tokens entsprechen (Tenant-ID, Suffix `/v2.0`).

## Keycloak

1. Im Realm einen **Client** anlegen: Client type *OpenID Connect*, *Standard flow* an,
   *Client authentication* aus (public client + PKCE) — oder an, dann `OIDC_CLIENT_SECRET` setzen.
2. *Valid redirect URIs*: `https://<middleware>/auth/callback`; *Web origins*: `https://<middleware>`.
3. Unter *Advanced* → *Proof Key for Code Exchange Code Challenge Method*: `S256`.
4. Werte:

```env
AUTH_MODE=oidc
OIDC_PROVIDER=keycloak
OIDC_ISSUER=https://<keycloak>/realms/<realm>
OIDC_CLIENT_ID=<client-id>
OIDC_SCOPES=openid profile email
PUBLIC_URL=https://<middleware>
```

## Lizenzschlüssel

Format und Signatur entsprechen dem bestehenden WerkWorks-Lizenzgenerator (Ed25519, siehe
[ee/README.md](../ee/README.md)). Konfiguration:

```env
OVP_LICENSE=<token>                       # oder OVP_LICENSE_PATH=/run/secrets/openvizpilot-license
OVP_LICENSE_PUBLIC_KEY_B64URL=<32 Bytes>  # oder OVP_LICENSE_PUBLIC_KEY_PATH=/etc/openvizpilot/public.pem
```

Ohne gültige Lizenz mit Feature `sso` startet die Middleware im OIDC-Modus **nicht** (klare Fehlermeldung);
abgelaufene Lizenzen deaktivieren die Enterprise-Funktionen. Der Status ist in der Admin-UI unter
„Edition, Lizenz & Anmeldung“ sichtbar.

Für Entwicklung und Tests: `npm run sign-license -w @openvizpilot/ee -- keygen ./keys` erzeugt ein
Schlüsselpaar, `… -- sign ./keys/private.pem "Firma GmbH" 2027-12-31` einen Token.

## Lizenz-Heartbeat

Eine lizenzierte Installation meldet sich einmal täglich bei WerkWorks — Umfang,
Verhalten und der Text für Vertrag und Lizenzdokument stehen in
[ee/telemetry/README.md](../ee/telemetry/README.md).

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
    key: OIDC_CLIENT_SECRET
license:
  existingSecret: openvizpilot-license   # Key OVP_LICENSE
  publicKeyB64url: <32 Bytes base64url>
app:
  publicUrl: https://chat.example.com
```

## Lizenzen ausstellen (WerkWorks)

Der Vertrauensanker ist der Public Key des WerkWorks-Lizenzgenerators
(`certpulse-license-generator/keys/public.pem`); er ist in `ee/server/src/license.ts` eingebettet und
per `OVP_LICENSE_PUBLIC_KEY_B64URL` überschreibbar. Der Generator stellt OpenVizPilot-Lizenzen
direkt aus:

```bash
certfleet-license generate --product openvizpilot \
  --licensee "Beispiel GmbH" --tier enterprise --days 365 \
  --out beispiel.openvizpilot-license
```

Ohne `--features` enthält die Lizenz alle Enterprise-Funktionen des Tiers; für einen kleineren
Umfang `--features sso,memory` o. ä. angeben. Dasselbe geht in der Weboberfläche des Generators
(Produktauswahl im Formular „Lizenz ausstellen"). `ee/scripts/sign-license.ts` bleibt als Notnagel,
falls der Generator gerade nicht verfügbar ist.

**Beim Upgrade beachten:** Lizenzen, die vor dieser Version mit einer ausdrücklichen
`features`-Liste ausgestellt wurden (typisch `["sso"]`), schalten `memory` und `savedQueries` NICHT
frei — beides war vorher lizenzfreie Kernfunktion. Solche Lizenzen neu ausstellen, wenn die
Personalisierung weiterlaufen soll; `GET /api/features` zeigt, was gerade aktiv ist.

## Lokal ausprobieren

`npm run dev:demo:sso` startet zusätzlich einen Mock-Identity-Provider (Port 4030, Auto-Login als
„Anna Beispiel“). Dazu in der `.env`: `AUTH_MODE=oidc`, `OIDC_PROVIDER=generic`,
`OIDC_ISSUER=http://127.0.0.1:4030`, `OIDC_CLIENT_ID=openvizpilot-dev`, `PUBLIC_URL=http://localhost:5173`
(Vite-Dev-Origin, der die Extension ausliefert) sowie eine Dev-Lizenz (siehe oben) — alternativ alles
in der Admin-UI eintragen.
