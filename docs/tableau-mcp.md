# Tableau-MCP: Tableau-Daten für Weave und andere Agenten (Enterprise)

OpenVizPilot stellt seine Tableau-Server-Tools als **MCP-Server** (Streamable HTTP) unter
`/api/tableau-mcp` bereit. Damit kann ein externer Agent — Weave, VS Code, Claude Code — in der
**persönlichen Identität** der angemeldeten Person Workbooks, Views und Datenquellen finden,
Kennzahlen erklären und (mit Freigabe und Einwilligung) Daten lesen. Die Extension und die
Desktop-App bleiben unverändert; der Endpunkt ist ein dritter Client derselben Hürden.

## Berechtigungsmodell — nichts wird gelockert

Die Grundregel von [tableau-server.md](tableau-server.md) gilt unverändert: **kein
Service-Account, kein PAT, kein frei übergebener Username.** Jeder Aufruf trägt ein OAuth-
Access-Token des Identity-Providers (Entra ID oder Keycloak), das OpenVizPilot wie das ID-Token der
Extension prüft (Signatur gegen JWKS, Issuer, Zeitfenster) — zusätzlich mit der **Audience der
MCP-Ressource** und den geforderten Scopes. Aus dem verifizierten Token entsteht die
Tableau-Identität (Username-Claim), unter der der Connected-App-Sign-in läuft; Tableau selbst
wendet danach Berechtigungen und Row-Level-Security an. Es gibt keinen Weg, eine andere Person
zu benennen: Weder ein Tool-Argument noch ein Header noch ein Weave-Delegations-Token wird als
Identität akzeptiert.

Darüber hinaus gelten je Aufruf, serverseitig geprüft:

1. Freigabe **„Tableau-API“** der Person (Admin → Benutzer & Zugriff) — sonst `403 approval_required`.
2. Aktive Tableau-Integration mit Lizenz `tableauServer` + `sso` und genau einer Site.
3. Daten-Tools (`tableau_view_data`, `tableau_datasource_fields`, `tableau_datasource_query`)
   erscheinen nur mit Lizenz `serverData` **und** Freigabe „Serverdaten“; sie brauchen zusätzlich
   die Einwilligung der Person und den Site-Schalter. Fehlt die Einwilligung, liefert das Tool
   nur den Einwilligungstext und den Hinweis, sie in Extension oder Desktop-App zu erteilen —
   ein MCP-Client kann sie nicht stellvertretend geben.
4. Budgets (8 View- bzw. 12 Datenquellen-Aufrufe je 2 Minuten) und Audit (`purpose: mcp`)
   wie in der Extension; alle Tools sind `readOnlyHint: true`, nichts schreibt.

Was die Person im Dashboard nicht sieht, bekommt sie auch über diesen Weg nicht: Die Antwort
kommt aus Tableau unter ihrer eigenen Anmeldung.

## Einrichtung

**Identity-Provider** — eine eigene Ressource für Tableau-MCP, getrennt von der
Extension-Client-ID (ID-Tokens sind keine MCP-Zugriffstokens):

- *Entra ID:* App-Registrierung „OpenVizPilot Tableau-MCP“, unter „Eine API verfügbar machen“ die
  App-ID-URI setzen (z. B. `api://openvizpilot-tableau`) und einen delegierten Scope `tableau.read`
  anlegen. Dem MCP-Client (Weave, VS Code: öffentlicher Client mit PKCE) diesen Scope erlauben.
  **Wichtig:** im Manifest dieser API-App `accessTokenAcceptedVersion` auf `2` setzen — sonst
  stellt Entra v1-Access-Tokens aus (Issuer `sts.windows.net`, ohne `preferred_username`), die
  OpenVizPilot gegen den konfigurierten v2-Issuer ablehnt. Der Username-Claim der
  Tableau-Konfiguration (z. B. `preferred_username`) muss im Access-Token stehen — bei v2-Tokens
  ist er enthalten.
- *Keycloak:* Client-Scope `tableau.read` mit Audience-Mapper auf die Ressource (z. B. Client
  `openvizpilot-tableau`), dem MCP-Client zuweisen.

**Middleware** (`.env` bzw. Helm `oidc.mcpAudience`/`oidc.mcpScopes`):

```
OVP_OIDC_MCP_AUDIENCE=api://openvizpilot-tableau
OVP_OIDC_MCP_SCOPES=tableau.read
```

Ohne `OVP_OIDC_MCP_AUDIENCE` bleibt der Endpunkt aus (404). `OVP_OIDC_MCP_SCOPES` ist nie leer: ohne Angabe
gilt `tableau.read` — ein App-only-Token (Client Credentials) trägt keinen delegierten Scope und
wird so immer abgelehnt; nur Personen kommen durch. Single Sign-On muss aktiv sein
(`OVP_AUTH_MODE=oidc` bzw. Admin-UI); `OVP_PUBLIC_URL` liefert die Adressen in den
Discovery-Metadaten.

**Discovery (RFC 9728):** `GET /.well-known/oauth-protected-resource` und
`…/oauth-protected-resource/api/tableau-mcp` nennen den Authorization-Server (Issuer) und die
Scopes; ein Aufruf ohne Token antwortet `401` mit `WWW-Authenticate: Bearer resource_metadata=…`,
sodass MCP-Clients den Login selbst starten. Reverse Proxy: beide Discovery-Pfade und
`/api/tableau-mcp` durchreichen.

## Weave anbinden

Weave-Nutzer sind über Entra angemeldet — für Tableau-MCP braucht Weave ein Access-Token **der
Person** mit der MCP-Audience (Authorization Code + PKCE gegen Entra, Scope `tableau.read`, wie
Weave es für seinen eigenen MCP-Server dokumentiert) und ruft damit `/api/tableau-mcp` als
MCP-Client auf. Ein Weave-Delegations-Token (n8n-Flows) oder ein technischer Dienst-Token reicht
bewusst **nicht**: Er beweist OpenVizPilot nicht die Identität der Person gegenüber Tableau.

Tools (Namen und Argumente wie im Chat, siehe [tableau-server.md](tableau-server.md)):
`tableau_server_search`, `tableau_metadata_search`, `tableau_metadata_field`,
`tableau_datasource_search`, mit Serverdaten `tableau_view_data`, `tableau_datasource_fields`,
`tableau_datasource_query`; mit gepflegtem Kennzahlenkatalog `lookup_metric`.
