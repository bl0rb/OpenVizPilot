# ADR-001: Tableau Server Integration als Enterprise-Feature

Status: Produktentscheidungen angenommen; technische Vorgaben fuer die Umsetzung festgelegt.
Datum: 2026-09-15. Produktentscheidungen: Matze. Technische Ausarbeitung: Codex.

## Kontext

Die [Roadmap](tableau-server-integration.md) erweitert den Dashboard-Chat um Content-Suche und Metadaten. Die Middleware erhaelt damit erstmals Tableau-Zugangsdaten und kann im Namen eines Anwenders Server-Inhalte abrufen. Diese neue Vertrauensgrenze braucht eine ausdrueckliche Identitaets- und Berechtigungspolitik.

Phase 0 liefert Entscheidungen und pruefbare Anforderungen. Die folgenden Sicherheitsmassnahmen sind noch zu implementieren; dieses Dokument bescheinigt keine bereits vorhandene Absicherung oder getestete Server-Kompatibilitaet.

## Entscheidung

| Thema | Festlegung | Herkunft |
|---|---|---|
| Edition | Enterprise; Connector-Implementierung unter `ee/` | Nutzerentscheidung |
| Lizenz | Feature-Schluessel `tableauServer` | Nutzerentscheidung |
| Mindestversion | Tableau Server 2025.3 einschliesslich | Nutzerentscheidung, im Chat praezisiert |
| REST-Basis | API 3.27 fuer MVP-Endpunkte; keine Cloud-only-Funktionen | Technische Vorgabe |
| Authentifizierung | Connected App mit Direct Trust; verifizierte OIDC-Identitaet | Technische Vorgabe |
| Aktivierung | Opt-in, gueltige `tableauServer`- und fuer OIDC `sso`-Freigabe, vollstaendige Konfiguration | Technische Vorgabe |
| MVP | Read-only Content-Suche und Metadata; VDS und Admin-Funktionen bleiben Phase 6 | Technische Vorgabe |
| PAT | Kein produktiver PAT-Fallback im MVP; spaetere Dev-/Admin-Variante separat bewerten | Technische Vorgabe |

Die Mindestversion ist eine Produkt-Supportgrenze. Neuere Versionen sind Zielplattformen, aber erst nach einem dokumentierten Integrationstest als getestet auszuweisen. Die offizielle Zuordnung fuer 2025.3 ist REST API 3.27. [Tableau: API-Versionen](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_versions.htm)

## Gepruefte API-Voraussetzungen

Pruefstand: 2026-09-15, offizielle Tableau-Dokumentation. Die verlinkten `current`-Seiten koennen spaeter auch neuere Funktionen beschreiben.

| Bereich | Befund und Auswirkung | Quelle |
|---|---|---|
| REST + JWT | Nur JWT-unterstuetzte Methoden verwenden; `tableau:content:read` fuer die unterstuetzten Content-GETs. Pro Endpoint sind Scope, Server-Version und Nutzerberechtigung zu pruefen. | [Server-Scopes](https://help.tableau.com/current/server/en-us/connected_apps_scopes.htm) |
| Direct Trust | HS256, Header `kid` und `iss`; Claims `iss`, `sub`, `aud=tableau`, `exp`, eindeutiges `jti`, `scp` als Liste. Domain-/Projektgrenzen fuer Embedding schuetzen REST/Metadata nicht. | [Direct Trust](https://help.tableau.com/current/server/en-us/connected_apps_direct.htm) |
| Session | JWT wird via REST Sign-in gegen Credentials-Token und Site-LUID getauscht. Folgeaufrufe verwenden `X-Tableau-Auth`. Tableau dokumentiert standardmaessig 240 Minuten fuer das Credentials-Token; JWT-Ablauf beendet diese Session nicht automatisch. | [REST-Authentifizierung](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm) |
| Metadata | REST muss verfuegbar, Metadata auf Server aktiviert und indexiert sein. GraphQL-Endpunkt: `/api/metadata/graphql`; Scope `tableau:content:read`. | [Metadata-Voraussetzungen](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html), [Direct Trust](https://help.tableau.com/current/server/en-us/connected_apps_direct.htm) |
| Externe Assets | Datenbank-/Tabellen-Lineage haengt von Data Management und abgeleiteten oder expliziten Berechtigungen ab. Fehlende Sichtbarkeit liefert eine unvollstaendige Erklaerung, keinen Anlass fuer Admin-Zugriff. | [Server-Asset-Berechtigungen](https://help.tableau.com/current/server/en-us/dm_perms_assets.htm) |
| Metadata-Filter | `FILTER_RESULTS` entfernt nicht autorisierte Ergebnisse; der Standard `OBFUSCATE_RESULTS` kann verdeckte Objekte zurueckgeben. Fuer unterstuetzte Query-Felder explizit filtern und fehlende Lineage kennzeichnen. | [PermissionMode](https://help.tableau.com/current/api/metadata_api/en-us/reference/permissionmode.doc.html), [Query-Beispiele](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_examples.html) |
| VDS, spaeter | Eigener Scope `tableau:viz_data_service:read` und API-Access-Berechtigung. Kein Scope und kein VDS-Aufruf im MVP. | [VDS-Konfiguration](https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_configuration.html) |

Dokumentationsabweichung: Die allgemeine Server-Scope-Seite erwaehnt fuer VDS auch `tableau:content:read`; Direct-Trust- und VDS-spezifische Dokumentation nennen `tableau:viz_data_service:read`. Fuer Phase 6 gilt die spezifische Dokumentation als Planungsbasis, mit Verifikation am Zielserver. Das blockiert REST/Metadata nicht.

## Threat Model

Zu schuetzen sind Connected-App-Secrets, Tableau-Sessions, Identitaetszuordnung und berechtigungspflichtige Metadaten. Vertrauensgrenzen: Browser -> Middleware, IdP -> Middleware, Admin-Konfiguration -> Connector, Middleware -> Tableau und Metadaten -> LLM/Chat.

| Bedrohung | Vorgabe fuer die Umsetzung | Nachweis |
|---|---|---|
| Fremde Tableau-Identitaet einschleusen | `sub` nur aus einem explizit konfigurierten Claim des serverseitig verifizierten OIDC-Tokens ableiten. Kein Browser-Username, kein Anzeigename, keine Fallback-Kette. | Gefaelschte, fehlende, leere oder nicht-string Claims werden abgelehnt, bevor Tableau aufgerufen wird. |
| Mapping-Kollision | Claim exakt uebernehmen; keine automatische Kleinschreibung, Domain-Entfernung oder Mapping-Tabelle im MVP. Betreiber muss einen vom IdP verwalteten, nicht selbst editierbaren und eindeutig zugeordneten Claim waehlen. | Zwei unterschiedliche IdP-Identitaeten und Domain-Namen auf korrekte Zuordnung pruefen. |
| Unterschiedliche Browser-/OIDC-Konten | Server-Kontext gehoert zum OIDC-gemappten Tableau-Konto; keine behauptete Gleichheit mit der Browser-Session. Dashboard-IDs sind Suchhinweise und werden durch Tableau autorisiert. | Fremde Workbook-ID liefert keine fremden Metadaten; Quellen benennen den jeweiligen Kontext. |
| Nutzer-/Site-uebergreifender Cache | Token-Schluessel umfasst Connection-ID, Config-Revision, Site-LUID, OIDC-Issuer/Subject, Tableau-Username und Scope-Satz. Keine REST-/Metadata-Ergebniscaches ueber Requests hinweg im MVP. | Nutzer A/B, Site A/B, Mapping- und Secret-Wechsel koennen keinen Cache-Eintrag teilen. |
| Wiederverwendung von Tokens | Sign-in-JWT: Ziel-TTL 60 Sekunden innerhalb des Server-Limits, neues `jti` je Versuch. Credentials-Token nur im RAM, lokale Nutzung maximal 5 Minuten und nie ueber die OIDC-Gueltigkeit hinaus. | Uhr-/Ablauftests; bei 401 Cache verwerfen, maximal einmal mit neuer Auth wiederholen; 403 nicht durch andere Identitaet umgehen. |
| Session bleibt nach Abschaltung aktiv | Lizenz, Auth und Config vor jedem Aufruf pruefen. Bei Ablauf, Rotation, Deaktivierung und beobachtetem Logout lokale Tokens verwerfen und Tableau-Sign-out best effort ausfuehren. Alle Replicas muessen Config-/Lizenzwechsel beachten. | Alte Cache-Eintraege nach Config-Wechsel unbrauchbar; Sign-out-Fehler werden ohne Token protokolliert. Lokales Loeschen allein ist keine Tableau-Revokation. |
| Secret-Abfluss | Secret-Referenz auf serverseitige Env-/Secret-Datei bevorzugen; keine Secret-Werte in normalen Settings, Browser-Antworten, Traces oder LLM-Kontext. UI zeigt nur konfiguriert/nicht konfiguriert. | Sentinel-Secret taucht weder in Settings-GET, DB-Settings, Logs noch Fehlerantworten auf. |
| SSRF durch Server-URL | Nur administrativ freigegebener HTTPS-Origin, TLS-Pruefung, keine URL-Credentials und keine fremden Redirects. Private Tableau-Netze gezielt zulassen; Loopback, Link-local und Metadata-Service-Ziele sperren, DNS-Aufloesung bei Verbindung absichern. | Redirect-, DNS-/IP- und URL-Tests; fremde Tool-URLs koennen kein Ziel bestimmen. |
| Zu grosse Rechte/Metadatenlecks | Fest definierte Read-only-Endpunkte und GraphQL-Queries, `FILTER_RESULTS` wo unterstuetzt; keine generische Proxy- oder Download-Funktion. Endpoint-Scopes alleine sind keine Anwendungs-Allowlist. | Negativtests mit unberechtigten Inhalten, verdeckten Assets und GraphQL-Teilfehlern. |
| Prompt Injection in Beschreibungen | Metadaten als nicht vertrauenswuerdige Quelldaten behandeln. Tool-/Query-Auswahl und Berechtigung bleiben serverseitig. Standardausgabe begrenzt auf fachliche Namen, Formeln und benoetigte Abhaengigkeiten; keine Connection-Strings oder Infrastruktur-Hosts. | Manipulierte Beschreibung darf keine weiteren Tools oder Datenfreigaben ausloesen; Quellen und Unsicherheit bleiben sichtbar. |
| Last/uebermaessiger Abruf | Vorgabe: 10 Sekunden Request-Timeout, hoechstens 100 Elemente pro Seite, 500 je Tool-Aufruf und 1 MiB Response; begrenzte Parallelitaet, maximal ein Retry bei 429/5xx innerhalb des Gesamtbudgets. | Pagination-Schleifen, grosse Responses und Zeitueberschreitungen abbrechen; Dashboard-Chat funktioniert weiter. |
| Unzureichender Audit/PII in Logs | Ereignisse fuer Config-Aenderung, Connection-Test, Auth und Tool-Aufruf: Zeit, Request-ID, pseudonymer Akteur, opake Connection-/Site-ID, Operation, Ergebniscode, Dauer und Anzahl. Keine Suchtexte, Payloads, Usernamen, JWTs oder Secrets. | Log-Redaktion mit Sentinel-Werten testen; bestehende Retention nutzen, keine automatische Speicherung in Memory. |

Die TTLs und Abruflimits oben sind OpenVizPilot-Vorgaben, keine behaupteten Tableau-Defaults. Ein kompromittiertes Connected-App-Secret kann weiterhin Identitaeten signieren; Secret-Verwahrung, Rotation und minimale Connector-Funktionen bleiben zentrale Betriebsanforderungen.

## Betrachtete Optionen

| Option | Vorteil | Nachteil | Ergebnis |
|---|---|---|---|
| Core-Connector | Einfache Verfuegbarkeit | Passt nicht zur gewaehlten Produktgrenze | Durch Enterprise-Entscheidung verworfen |
| Connected App + OIDC | Nachvollziehbare Nutzeridentitaet und begrenzte Scopes | Claim-Vertrauen, Secret-Rotation und JWT-Endpunktabdeckung erforderlich | MVP |
| Globaler PAT | Einfacher technischer Zugriff | Ergebnisse gehoeren zum PAT-Konto; ungeeignet fuer Nutzerberechtigungen | Kein MVP-Fallback |
| Individuelle PATs | Individuelle Tableau-Rechte | Zusaetzliche Nutzer-Secrets, Provisionierung und Rotation | Spaeter neu bewerten |

## Konsequenzen und Phase-1-Uebergabe

Die Produktentscheidungen fuer Phase 0 sind abgeschlossen. API-Voraussetzungen und Threat Model sind dokumentiert. Die praktische Freigabe erfolgt erst durch die nachfolgenden Implementierungs- und Integrationstests.

### Ausgangslage im Repository

Historischer Stand der Phase-0-Pruefung, vor Implementierung von Phase 1. Den aktuellen Umsetzungsstand dokumentieren [Roadmap](tableau-server-integration.md) und [Einrichtung](tableau-server-setup.md).

- [Lizenzschema](../ee/server/src/license.ts): `EE_FEATURES` enthaelt `tableauServer` noch nicht. Lizenzen mit diesem expliziten Feature erst nach Schema-Erweiterung ausstellen; Feature-Labels und Generator-Kompatibilitaet mitpruefen.
- [OIDC-Verifikation](../ee/server/src/oidc.ts) und [Auth-Routen](../ee/server/src/auth-routes.ts): Signatur-/Issuer-/Audience-Pruefung ist vorhanden; die gezielte Uebergabe eines konfigurierbaren Tableau-Claims fehlt.
- [Admin-Settings](../packages/server/src/routes/admin.ts): Vorhandene Secret-Maskierung in Antworten ist keine verschluesselte Speicherung. Fuer Tableau das [MCP-Referenzmuster](../ee/server/src/mcp/config.ts) als Ausgangspunkt pruefen; nur erlaubte Secret-Referenzen aufloesen.
- [Logger](../packages/server/src/logger.ts): Metadatenlogging vorhanden, aber keine automatische Secret-Redaktion oder dedizierte dauerhafte Audit-Ablage. Ereignisschema und Redaktion muessen vor Connector-Aufrufen eingefuehrt werden; Betrieb regelt Zugriff und Aufbewahrung im Log-System.
- Es gibt noch keinen Tableau-Server-Connector. Die Mindestversion betrifft diesen Connector und aendert nicht die bisherige Extensions-API-Mindestversion des Core-Manifests.

1. [ ] `tableauServer` in Lizenzpruefung, Feature-Ausgabe und Tests aufnehmen; `sso`-Abhaengigkeit fuer OIDC ausdruecklich abbilden.
2. [ ] Verifizierten Claim gezielt im serverseitigen Auth-Kontext verfuegbar machen; keine ungeprueften Claims an den Connector reichen.
3. [ ] Enterprise-Connector, versionierte Connection-Konfiguration und Secret-Referenzen mit Admin-Validierung implementieren.
4. [ ] URL-/TLS-Policy, Sign-in/-out, isolierten Token-Cache und strukturierte Fehler implementieren; Sicherheitsfaelle aus obiger Tabelle testen.
5. [ ] Connection-Test zweistufig planen: Admin prueft Konfiguration; persoenlich authentifizierter Test prueft User-Zugang. Admin-Login allein ist keine Tableau-Nutzeridentitaet.
6. [ ] Fuer Phase 2 eine Endpoint-Matrix fuer Workbooks, Views, Projekte und Datenquellen mit Server-2025.3-Scope, Pagination und Rollenanforderungen erstellen. Jobs, Refreshes und Permissions separat auf Admin-Bedarf pruefen.
7. [ ] Vor Release gegen Server 2025.3 und eine dann aktuelle unterstuetzte Version testen: zwei Nutzer mit unterschiedlichen Rechten, zwei Sites, abgelaufene Tokens, Secret-Rotation sowie Metadata mit/ohne externe Asset-Sichtbarkeit.

Noch fuer die Integrationstests benoetigt: konkrete Testinstallation, aktivierte Connected App, Secret-Referenz, Site, freigegebener IdP-Claim und Testkonten. Diese Betriebswerte werden nicht in die Roadmap geschrieben.
