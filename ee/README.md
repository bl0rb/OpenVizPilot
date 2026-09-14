# OpenVizPilot Enterprise Edition (ee/)

Dieser Ordner enthält die Enterprise-Funktionen von OpenVizPilot. Er steht **nicht** unter der
PolyForm-Noncommercial-Lizenz des restlichen Repos, sondern unter der proprietären
[Enterprise-Lizenz](LICENSE) — produktiv nutzbar nur mit gültigem Lizenzschlüssel.

## Was drin ist

| Modul | Zweck |
|---|---|
| `server/src/license.ts` | Prüft signierte Lizenzschlüssel (Ed25519, Format des WerkWorks-Lizenzgenerators) und schaltet Features frei |
| `server/src/oidc.ts` | OIDC-Client: Discovery, JWKS, ID-Token-Verifikation (RS256), Code-Austausch (BFF) — Microsoft Entra ID, Keycloak, generisch |
| `server/src/auth-routes.ts` | `/api/auth/config`, `/api/auth/exchange`, `/auth/callback`, Auth-Middleware (`authUser` = verifizierter `sub`) |
| `server/src/personalization.ts` | User-Memory (Fakten-Extraktion + `/api/memory`), gespeicherte eigene Abfragen (`/api/memory/prefs`) und die Prompt-Bausteine beider Funktionen — lizenzpflichtig über `memory` bzw. `savedQueries` |
| `server/src/personalization-store.ts` | Eigene Tabellen (`user_facts`, `user_memory_state`, `user_dashboard_prefs`) samt Nebenläufigkeits-Garantie gegen Wiederauferstehung gelöschter Fakten — auf der Verbindung, die der Kern ohnehin hält |
| `server/src/personalization-schema.ts` | Datenvertrag der Präferenzen, Fokus-Vorschläge und die Regeln fürs Speichern eigener Fragen |
| `server/src/mcp/` | MCP-Client, Admin-Verwaltung, Site-Freigaben, eigene Tabellen und serverseitige Lizenzprüfung über `mcp` |
| `server/src/system-prompt.ts` (Kern, lizenzabhängiger Abschnitt) | Dashboard-Aktionen (Filter, Parameter, Markieren, Bereich) im System-Prompt — lizenzpflichtig über `actions` |
| `extension/src/mcp-client.ts` | Bestätigung externer Datenübertragungen und authentifizierte MCP-Aufrufe |
| `extension/src/oidc-login.ts` | Popup-Login mit PKCE aus der Tableau-Extension heraus, Sitzung im `sessionStorage` |
| `extension/src/LoginPanel.tsx` | Login-Ansicht der Extension |
| `extension/src/MemoryFactsPanel.tsx` | Gespeicherte Infos über den Anwender ansehen und löschen |
| `extension/src/SavedQueriesPanel.tsx` | Antwortfokus und eigene Standardfragen je Dashboard |
| `extension/src/prefs-client.ts` | Lädt und speichert die eigenen Abfragen über `/api/memory/prefs` |
| `scripts/sign-license.ts` | Dev-/Betriebs-Werkzeug: Schlüsselpaar erzeugen, Lizenz signieren/prüfen |
| `scripts/mock-oidc.ts` | Lokaler Mock-IdP für `npm run dev:demo:sso` |

Der Kern enthält von diesen Funktionen **keine Implementierung** mehr: keine Tabellen, keine
Extraktion, keine Prompt-Bausteine, kein Schema, keine Bedienoberfläche. Er stellt nur die
Datenbankverbindung, den Chat-Ablauf und die generische Chip-Darstellung — alles, was die
lizenzpflichtigen Funktionen ausmacht, liegt unter dieser Lizenz.

Einrichtung (Entra, Keycloak, Lizenz, Helm): [docs/enterprise.md](../docs/enterprise.md).
MCP-Einrichtung und Site-Berechtigungen: [docs/mcp.md](../docs/mcp.md).

## Lizenzformat

Identisch zum bestehenden WerkWorks-Lizenzgenerator (`certpulse-license-generator`):
`<base64url(JSON)>.<base64url(Ed25519-Signatur über die rohen JSON-Bytes)>`. Payload:

```json
{ "formatVersion": "openvizpilot-license-v1", "licenseId": "…", "tier": "enterprise",
  "licensee": "Firma GmbH", "issuedAt": "2026-09-02T…", "validUntil": "2027-09-02T…",
    "features": ["sso", "memory", "savedQueries", "mcp", "actions"] }
```

Lizenzen stellt der WerkWorks-Lizenzgenerator direkt aus:
`certfleet-license generate --product openvizpilot --licensee "Firma GmbH" --tier enterprise --days 365`
— ohne `--features` enthält der Token alle Enterprise-Funktionen des Tiers, sonst z. B.
`--features sso,memory`. Der Signaturteil ist bei allen Produkten identisch (Ed25519 über die rohen
JSON-Bytes, base64url); `scripts/sign-license.ts` bleibt als Notnagel, wenn der Generator nicht zur
Hand ist.

**Upgrade-Hinweis:** Lizenzen, die vor Einführung von `memory`/`savedQueries`/`actions` mit
ausdrücklicher `features`-Liste ausgestellt wurden (typisch `["sso"]`), schalten diese Funktionen
NICHT frei — sie waren vorher lizenzfreie Kernfunktionen. Solche Lizenzen neu ausstellen;
`GET /api/features` zeigt den aktuellen Stand.

Für MCP muss eine explizite Feature-Liste zusätzlich `mcp` enthalten. Die MCP-Prüfung
erfolgt vor Tool-Discovery, Admin-Verbindungstests und jeder Ausführung. Für Dashboard-Aktionen aus
dem Chat (Filter, Parameter, Markieren, Bereich) muss sie zusätzlich `actions` enthalten — ohne
Lizenz kennt das Modell die Aktionssyntax gar nicht, und die Extension verwirft eine dennoch
auftauchende Aktionsliste zusätzlich clientseitig. Ein externer
Lizenzgenerator mit festem Produktkatalog muss diese neuen Schlüssel ebenfalls
kennen; dieser Katalog liegt nicht in diesem Repository.
