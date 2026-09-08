# MCP-Quellen und Websuche (Enterprise)

OpenVizPilot kann freigegebene MCP-Tools im Tableau-Chat verwenden. Das Feature
liegt in `ee/` und benötigt eine gültige Enterprise-Lizenz mit `mcp`. Lizenzen
ohne explizite Feature-Liste schalten wie bisher alle Enterprise-Funktionen frei.
Eine Lizenz mit ausschließlich `sso`, `memory` oder `savedQueries` reicht nicht.

MCP ist eine Schnittstelle, keine Suchmaschine: Für Websuche muss der angebundene
MCP-Server selbst einen Suchdienst bereitstellen. Es ist kein Suchanbieter
voreingestellt, und OpenVizPilot startet keine beliebigen MCP-Prozesse.

## Voraussetzungen

- Datenbank der Middleware: SQLite lokal oder Postgres im Deployment.
- Persönliche Anmeldung über lokale Benutzerkonten oder OIDC. OIDC braucht
  zusätzlich `sso`; MCP mit lokalen Konten benötigt nur `mcp`.
- Ein vom Betreiber geprüfter MCP-Server mit Streamable HTTP über HTTPS.
- Explizite Tool-Freigaben; der Server muss die Tools zusätzlich mit
  `readOnlyHint: true` und ohne `destructiveHint: true` deklarieren.
- Netzwerkerreichbarkeit vom Middleware-Host zum freigegebenen MCP-Endpunkt.

Offener Modus und Shared-Token-Modus stellen keine MCP-Tools bereit, weil sie
keine überprüfbare individuelle Site-Mitgliedschaft liefern.

## Einrichtung in der Admin-UI

1. Unter **Anmeldung, Single Sign-On & Lizenz** die passende Lizenz aktivieren.
2. Unter **MCP & Sites (Enterprise)** auf **Aktualisieren** klicken.
3. Eine **Site hinzufügen**, benennen und ihre bereits registrierten Dashboards
   auswählen. Jedes Dashboard darf genau einer Site zugeordnet sein.
4. Die erlaubten lokalen Benutzer auswählen. Für OIDC im Feld **Weitere
   Identitäten** pro Zeile `oidc:<sub>` eintragen, mit dem tatsächlichen `sub`
   des aktuell konfigurierten Identity-Providers. Nicht die Tableau-User-ID und
   nicht die E-Mail-Adresse verwenden, sofern diese nicht tatsächlich der `sub` ist.
5. Einen **MCP-Server hinzufügen**, Namen und vollständigen HTTPS-Endpunkt
   eintragen. Optional die Secret-Referenz setzen, beispielsweise
   `OVP_MCP_KNOWLEDGE_TOKEN`.
6. **Verbindung prüfen & Tools laden**, die benötigten lesenden Tools auswählen
   und die Sites markieren, denen dieser Server zur Verfügung stehen soll.
7. **Aktiviert** setzen und **Freigaben speichern**. Ohne Site-Zuordnung oder
   passende Nutzerfreigabe bleibt der Server für den Chat unsichtbar.

Server können deaktiviert oder entfernt, Sites und Mitglieder geändert werden.
Änderungen greifen beim nächsten Tool-Aufruf, auch über mehrere Middleware-Replicas.
Offene Chat-Freigaben werden durch Konfigurationsänderungen ungültig. Bei gleichzeitig
bearbeiteten Admin-Seiten verhindert eine Versionsprüfung versehentliches Überschreiben.

Die Verbindung wird nur getestet; kein Tool wird dabei ausgeführt. Nicht unterstützte
oder nicht als lesend deklarierte Tools werden nicht angeboten. Nach einer Änderung
des Endpunkts oder der Secret-Referenz muss die Tool-Auswahl erneuert werden.

## Site- und Berechtigungsmodell

Die Sites sind **administrativ gepflegte Zuordnungen in OpenVizPilot**. Es gibt
noch keinen automatischen Abgleich mit Tableau Server/Cloud, keine Ermittlung der
Tableau-Site aus dem Browser und keine Synchronisation von Tableau-Gruppen.

Ein vom Browser gelieferter Dashboard-Schlüssel ist nur die Konfigurationsauswahl,
kein Berechtigungsnachweis. Die Middleware prüft zusätzlich die verifizierte
Anmeldung und die explizite Site-Mitgliedschaft. Ein berechtigter Site-Nutzer
kann diese Quellen auch mit einem direkten API-Client verwenden; die Zuordnung
beweist nicht, dass gerade ein bestimmtes Workbook im Browser geöffnet ist.

Tableau-Abfragen bleiben in der Tableau-Sitzung des Viewers. Externe Quellen
verwenden dagegen die **gemeinsame Berechtigung des konfigurierten MCP-Servers**.
Es gibt noch keine nutzerbezogene OAuth-Delegation zu MCP-Servern. Deshalb dürfen
einer Site nur Quellen zugewiesen werden, deren freigegebene Inhalte alle dort
eingetragenen Nutzer sehen dürfen. Bei unterschiedlichen Zugriffsrechten sind
separate, entsprechend eingeschränkte Server-/Credential-Konfigurationen nötig.
Bei einem Wechsel des OIDC-Issuers müssen die Mitgliedschaften überprüft werden.

## Zugangsdaten und Deployment

Tokens werden nicht in der Admin-UI gespeichert. Sie kommen aus serverseitigen
Umgebungsvariablen mit dem Präfix `OVP_MCP_`. Die Admin-UI speichert lediglich den
Variablennamen. Der Client sendet dieses Token als `Authorization: Bearer ...`
an genau den konfigurierten MCP-Endpunkt. Tokens anderer Namensräume können nicht
referenziert werden; das Token der Chat-Anmeldung wird niemals weitergereicht.

Die Variablen müssen im Prozess-Environment vorliegen, lokal beispielsweise über
die vorhandene `.env`-Ladung. Für Helm können bestehende Kubernetes-Secrets eingebunden werden:

```yaml
mcp:
  secretRefs:
    - env: OVP_MCP_KNOWLEDGE_TOKEN
      secretName: mcp-knowledge
      key: token
```

Das Secret muss separat bereitgestellt werden. Nach Token-Rotation müssen die
Pods neu gestartet werden, weil Kubernetes-Secret-Umgebungswerte nicht live wechseln.
Endpunkt, Tool-Auswahl und Site-Freigaben werden dagegen ohne Redeploy in der
Admin-UI gepflegt. Ohne Authentifizierung am MCP-Server bleibt die Secret-Referenz leer.

Es gibt keine Stdio-Ausführung, keine OAuth-Anmeldung am MCP-Server und keine
Unterstützung des alten HTTP+SSE-Transports. Der Pilot nutzt das offizielle
TypeScript-SDK mit Streamable HTTP. MCP-Resources, Prompts, Sampling und
Elicitation werden nicht eingebunden. Ergebnisse werden als Text bzw. strukturierte
JSON-Inhalte verarbeitet, nicht als Bilder, eingebettete Ressourcen oder aktive UI.

## Verhalten im Chat

Die Middleware ergänzt den LLM-Tool-Katalog nur um lizenzierte und für den
angemeldeten Nutzer freigegebene Site-Tools. Die Extension führt Tableau-Tools
weiterhin lokal aus; MCP-Aufrufe laufen über `POST /api/mcp` in der Middleware.

Vor jedem externen Aufruf bestätigt der Nutzer einen Dialog mit Ziel, Tool und
den konkreten Argumenten. Ohne Bestätigung findet kein Aufruf statt. Die
Modellhistorie und Dashboard-Kontext werden nicht automatisch an den MCP-Server
gesendet. Das Modell kann allerdings vertrauliche Angaben in Suchargumente
übernehmen: Die Bestätigung ist daher eine echte Freigabeentscheidung, kein
Ersatz für Datenklassifizierung oder eine technische DLP-Lösung.

Ein signiertes Ticket bindet den Aufruf für höchstens zwei Minuten an Nutzer,
Dashboard, genaue Argumente und Konfigurationsversion. Ohne gültiges Ticket
wird der Ausführungs-Endpunkt abgewiesen. Lizenz, Mitgliedschaft, Serverfreigabe,
Read-only-Deklaration und Argument-Schema werden serverseitig erneut geprüft.
Tickets sind innerhalb ihrer Gültigkeit wiederverwendbar; sie sind kein
verteiltes Einmal- oder Kostenkontingent.

Externe Quellen ergänzen ausschließlich dashboardbezogene Fragen. Beispiel:
**„Welche öffentlichen Entwicklungen könnten den Rückgang in dieser Region
erklären?“** Bei Karten können die über `get_selected_marks` verfügbaren
Ortsangaben für eine gezielte Recherche verwendet werden. Allgemeine Websuche
ohne Dashboard-Bezug bleibt außerhalb des Themenbereichs.

Externe Ergebnisse enthalten Quellenkennung und Abrufzeit. Das Modell soll
gelieferte Quellen-URLs nennen, externe Informationen von Tableau-Zahlen trennen
und Erklärungsansätze nicht als bewiesene Ursachen ausgeben. Qualität und
Aktualität hängen vom angebundenen Such-/Fachsystem ab; Abrufzeit ist nicht
Veröffentlichungszeit.

## Sicherheits- und Betriebsgrenzen

- Admin-Endpunkte bleiben hinter der bestehenden Admin-Authentifizierung.
  Lesen, Ändern und Verbindungstest benötigen `mcp`; andernfalls `402 license_required`.
- Endpunkte müssen HTTPS nutzen, ohne URL-Credentials, Query oder Fragment.
  Redirects und Wechsel auf andere Ziele werden blockiert.
- Ein Admin darf bewusst interne HTTPS-Endpunkte konfigurieren. Das ist keine
  allgemeine Sperre privater Netze: Egress/NetworkPolicies müssen den Zugriff
  zusätzlich auf genehmigte Ziele beschränken, insbesondere bei internem DNS.
- Die Read-only-Deklaration ist eine Behauptung des MCP-Betreibers. Sie ersetzt
  keine Prüfung des Servers und keine eingeschränkten Quellsystem-Zugangsdaten.
- Maximal 5 Server, 10 Tools je Server, 50 Sites; alle Argumente werden gegen das
  aktuelle JSON-Schema validiert. Keine ungeprüfte Übernahme des gesamten Tool-Katalogs.
- Pro MCP-Verbindung gilt ein Gesamt-Timeout von 15 Sekunden, pro HTTP-Antwort
  ein Limit von 256 KiB, für den zurückgegebenen Text 16.000 Zeichen.
- Pro Server-Gateway und Middleware-Prozess maximal 4 aktive Verbindungen sowie
  30 Ausführungsversuche pro Minute. Für globale Kostenlimits braucht es zusätzlich
  Quoten im Gateway/Provider oder Reverse Proxy. Bei Konfigurationswechsel werden
  Prozess-Caches verworfen; die Limits sind keine dauerhafte Abrechnung.
- Bei fehlender Lizenz, unbekannten Mitgliedern oder Konfigurationsfehlern werden
  keine Tools angeboten. Ist eine Quelle ausgefallen, bleibt der Tableau-Chat nutzbar.
- Remote-Fehlertexte und Credentials werden nicht an den Chat durchgereicht.
  Tool-Argumente und Resultate werden nicht im Server-Log gespeichert; im Browser
  erscheinen sie wie bestehende Tableau-Aufrufe im Analyseverlauf.
- Chat-Historie bleibt im Browser. Die EE-Datenbank speichert Site-Mitglieder,
  Dashboard-Zuordnungen, Server-Endpunkte, Secret-Namen und Freigaben, keine MCP-Ergebnisse.

## Prüfung

```bash
npm test -- ee/test/mcp-config.test.ts ee/test/mcp-gateway.test.ts ee/test/mcp-store.test.ts ee/test/mcp-service.test.ts ee/test/mcp-admin.test.ts ee/test/mcp-client.test.ts ee/test/mcp-chat.test.ts packages/extension/test/agent-loop-request.test.ts
npm run typecheck
npm run build
```

Die Tests nutzen isolierte Testlizenzen und Fixtures, einschließlich des echten
MCP-SDKs gegen simulierte Protokollantworten. Vor Produktivfreigabe zusätzlich den
konkreten MCP-Anbieter in einer Test-Site prüfen: Quellenrechte, Datenweitergabe,
Suchqualität, Timeout/Abbruch, Lizenzentzug und Quellenangaben.