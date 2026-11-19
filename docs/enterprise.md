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
| `mcp` | MCP-Quellen und Websuche mit zentraler Admin-Verwaltung und Bereichs-Freigaben |
| `actions` | Dashboard-Aktionen aus dem Chat: Filter setzen/zurücksetzen, Parameter ändern, Marks markieren, Bereiche ein-/ausblenden |
| `tableauServer` | Tableau-Server-Konfiguration, persönlicher Connected-App-Sign-in, Workbook-/View-Suche und Metadata-API (Feldsuche/-detail); benötigt OIDC und `sso`. |
| `serverData` | Serverseitiger Datenzugriff (Watch/Cross-Dashboard): liest Summary-Daten einer Tableau-View außerhalb des aktuellen Dashboards im Namen des Nutzers und — mit Site-Schalter „Datenquellen abfragen“ — veröffentlichte Datenquellen über den VizQL Data Service; benötigt zusätzlich `tableauServer`/`sso`, den Site-Schalter „Serverseitige Daten erlauben“, die Freigabe „Serverdaten“ je Person und deren Einwilligung. |
| `watch` | Watch: beobachtet eine Tableau-View nach Zeitplan im Namen des Nutzers und meldet Auffälligkeiten per Webhook, Microsoft Teams oder E-Mail; benötigt zusätzlich `serverData`, `tableauServer` und `sso` — siehe [docs/watch.md](watch.md). |

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

MCP wird unter **MCP-Quellen (Enterprise)** in der Admin-UI eingerichtet. Es benötigt
persönliche Anmeldung, explizite Bereichs-Mitgliedschaften und eine eigene `mcp`-Freigabe.
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

**Tableau Desktop** fängt Popups ab, und Entra ID lässt sich nicht einbetten. Dort öffnet die Extension den
IdP deshalb im System-Browser. Nach der Anmeldung legt `/auth/callback` den Code über `POST /auth/callback/relay`
in der Betriebsdatenbank ab (Tabelle `ee_auth_relay`, nur Hashes von state und Bestätigungscode, 5 Minuten,
einmalig) und zeigt einen 6-stelligen **Bestätigungscode**. Die Person tippt ihn in der Extension ein; erst
damit gibt `POST /auth/callback/relay/take` den Code heraus (höchstens 5 Versuche), danach folgt Schritt 4.
Der Bestätigungscode verhindert, dass jemand einen selbst gestarteten Login per Link unterschiebt und bei
stillem SSO den Code der angemeldeten Person abholt — er erscheint nur in deren Browser.

## Einrichtung über die Admin-UI (empfohlen)

Alles Folgende lässt sich ohne Redeploy in der Admin-UI (`/admin`) pflegen: unter **„Anmeldung“**
Anmeldemodus, öffentliche URL und Identity-Provider (Entra ID / Keycloak / generisch) mit Issuer,
Client-ID, optionalem Client-Secret und Scopes — in drei nummerierten Schritten —, unter
**„Lizenz & Aktivierung“** den Lizenzschlüssel. Beide Bereiche speichern getrennt; „Lizenz prüfen &
speichern“ verifiziert die Lizenzsignatur, und „Anmeldung“ lehnt Single Sign-On ohne gültige SSO-Lizenz ab; gespeicherte Werte gelten sofort für alle Replicas und überschreiben die
Env-Defaults (`OVP_AUTH_MODE`, `OVP_OIDC_*`, `OVP_LICENSE`). Secrets und Token werden nie zurückgegeben,
nur als „vorhanden“ angezeigt.

Für die Core-Edition gibt es daneben den Modus **„Benutzerkonten“**: Der Admin legt unter
**„Benutzer & Zugriff“ → „Lokale Benutzerkonten“** Konten mit Passwort an, die Anwender melden sich damit in der
Extension an (Sitzungs-Token, 12 h, Lockout nach 5 Fehlversuchen). Das ist der Weg ohne Lizenz.

## Voraussetzungen

- Enterprise-Lizenz mit Feature `sso` (siehe unten).
- Die Middleware liefert die Extension aus (Same-Origin) und ist per HTTPS unter einer festen URL erreichbar.
  Diese **öffentliche URL** muss bekannt sein (Feld in der Admin-UI oder `OVP_PUBLIC_URL`): Aus ihr entsteht die
  Redirect-URI `<URL>/auth/callback`; sie wird bewusst nie aus dem Host-Header eines Requests abgeleitet.
  Ohne sie bleibt SSO blockiert.
- Tableau Server/Cloud: Popups aus der Extension müssen erlaubt sein (Standard).
- Tableau Desktop: Login über den System-Browser mit Bestätigungscode (siehe Ablauf). Braucht die
  Betriebsdatenbank wie die Benutzerfreigaben ohnehin; mit mehreren Replicas Postgres, Sticky Sessions sind
  nicht nötig. Die Relay-Endpunkte antworten nur bei aktivem SSO und sind zwangsläufig unangemeldet —
  zusätzlich zu den Grenzen in der Middleware (8 KiB, kein Überschreiben, höchstens 10 000 Einträge, wenige
  gleichzeitige DB-Zugriffe) ein Ratenlimit je Client am Ingress für `/auth/callback/relay*` setzen; die
  Middleware selbst kennt hinter dem Ingress keine verlässliche Client-IP.
- Keycloak: Der Code verfällt nach dem *Client login timeout* des Realms (Standard 1 Minute). Für Tableau
  Desktop muss der Bestätigungscode innerhalb dieser Zeit eingegeben sein — bei Bedarf den Wert erhöhen.

## Microsoft Entra ID

1. **App-Registrierung** anlegen (Entra Admin Center → App registrations → New registration).
2. Plattform **Web** mit Redirect-URI `https://<middleware>/auth/callback`.
3. Unter *Certificates & secrets* einen **Client-Secret** anlegen und als `OVP_OIDC_CLIENT_SECRET` oder im
   Admin (Feld „Client-Secret“) hinterlegen — Ablaufdatum notieren. Entra verlangt ihn, weil die Middleware den
   Anmeldecode serverseitig einlöst (Backend-for-Frontend): Ohne Secret scheitert der Tausch mit AADSTS7000218,
   mit der Plattform **Single-page application** mit AADSTS9002327. Die Extension meldet dann „Anmeldung
   abgelehnt“, das Server-Log `oidc exchange failed` mit dem AADSTS-Code.
4. Name und E-Mail für die Freigabeliste liest die Middleware aus dem ID-Token (`name`, `email`, sonst `upn`,
   `unique_name`, `preferred_username`). Fehlen sie dort, fragt sie beim Login einmal den `userinfo`-Endpunkt
   (Microsoft Graph) ab — dafür reichen die delegierten Graph-Berechtigungen `openid`, `profile`, `email`. Optional
   unter *Token configuration* `email` ergänzen, dann entfällt diese Abfrage.
5. Werte:

```env
OVP_AUTH_MODE=oidc
OVP_OIDC_PROVIDER=entra
OVP_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OVP_OIDC_CLIENT_ID=<application-(client)-id>
OVP_OIDC_CLIENT_SECRET=<client-secret-wert>
OVP_OIDC_SCOPES=openid profile email
OVP_PUBLIC_URL=https://<middleware>
```

`OVP_OIDC_CLIENT_SECRET` gilt auch, wenn Issuer und Client-ID in der Admin-UI eingetragen sind, solange dort
kein eigenes Secret gespeichert ist und die Env nicht auf einen anderen Issuer oder Client zeigt.

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

```env
OVP_LICENSE=<token>       # oder OVP_LICENSE_PATH=/run/secrets/openvizpilot-license
```

Alternativ in der Admin-UI unter „Lizenz & Aktivierung“. Ohne gültige Lizenz mit Feature `sso` startet die
Middleware im OIDC-Modus **nicht** (klare Fehlermeldung); abgelaufene Lizenzen deaktivieren die
Enterprise-Funktionen. Der Status steht in der Admin-UI unter „Lizenz & Aktivierung“ und auf der „Übersicht“.

Eine Lizenz erlaubt **eine produktive** Installation; Entwicklung, Test und Staging (`OVP_ENVIRONMENT`, Helm
`app.environment`) sind inklusive. Enterprise-Funktionen laufen erst, wenn sich die Installation aktiviert
hat — online über eine tägliche Lizenzmeldung (ausgehend HTTPS auf `werkworks.de`, Port 443) oder per
Offline-Aktivierung in der Admin-UI; bis dahin laufen nur die Core-Funktionen. Aktivierung, Lizenzzustände
und den Bezug des privaten Enterprise-Images beschreibt die Betriebsanleitung, die Kunden mit der Lizenz
erhalten. Anfragen, auch zum Source-Review unter Vertrag/NDA: info@werkworks.de.

## Helm

```yaml
auth:
  mode: oidc
oidc:
  provider: entra                # oder keycloak
  issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
  clientId: <client-id>
  clientSecretSecret:            # Entra ID: Pflicht · Keycloak: nur confidential clients
    existingSecret: openvizpilot-oidc
    key: OVP_OIDC_CLIENT_SECRET
license:
  existingSecret: openvizpilot-license   # Key OVP_LICENSE
app:
  publicUrl: https://chat.example.com
  environment: production                # development | test | staging zählen nicht gegen die Lizenz
```

## Lokal ausprobieren

`npm run dev:demo:sso` startet zusätzlich einen Mock-Identity-Provider (Port 4030, Auto-Login als
„Anna Beispiel“). Dazu in der `.env`: `OVP_AUTH_MODE=oidc`, `OVP_OIDC_PROVIDER=generic`,
`OVP_OIDC_ISSUER=http://127.0.0.1:4030`, `OVP_OIDC_CLIENT_ID=openvizpilot-dev`, `OVP_PUBLIC_URL=http://localhost:3000`
sowie eine Dev-Lizenz (nur im Enterprise-Repository: `npm run sign-license -w @openvizpilot/ee`) — alternativ alles in der Admin-UI eintragen. `OVP_PUBLIC_URL` muss auf
die **Middleware** zeigen, nicht auf den Vite-Dev-Server: Die Redirect-URI `<OVP_PUBLIC_URL>/auth/callback`
wird von der Middleware ausgeliefert (Port 3000).
