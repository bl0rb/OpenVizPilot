# Benutzerfreigaben

Die Extension verwendet den konfigurierten Anmeldemodus: lokale Benutzerkonten oder Enterprise-SSO. Anmeldung und Funktionsfreigabe sind getrennt. Eine Anmeldung an der Extension verleiht keine Admin-Rechte.

## Ablauf

1. Ein Administrator legt ein lokales Konto an, oder ein Benutzer meldet sich erstmals erfolgreich per SSO an.
2. Die Identität erscheint im Admin-Bereich unter Benutzerzugriff. Beide Freigaben sind zunächst deaktiviert.
3. Der Administrator vergibt **KI-Chat** und **Tableau-API** unabhängig voneinander und speichert die Zeile.
4. Die Extension zeigt den Freigabestatus an. Er wird alle 30 Sekunden sowie über „Status aktualisieren“ neu geladen.

KI-Chat erlaubt die KI-Endpunkte einschließlich Modelle, Personalisierung und MCP-Nutzung. Tableau-API erlaubt REST- und Metadata-Anfragen der Extension. Die Tableau-Tools im Chat erfordern beide Freigaben. Lizenzen, MCP-Freigaben, Tableau-Berechtigungen und die persönliche OIDC-Zuordnung bleiben zusätzliche Voraussetzungen. Ein lokales Konto erhält durch die API-Freigabe keine Tableau-Identität.

## Sicherheit und Betrieb

- Alle Freigaben werden serverseitig bei jedem Request aus der Datenbank geprüft. Ein Widerruf sperrt den nächsten Request; bereits gestartete externe Operationen werden nicht rückwirkend zurückgenommen.
- SSO-Identitäten werden durch Issuer und Subject getrennt, nicht über E-Mail oder Anzeigenamen zusammengeführt. Lokale Namen liegen in einem eigenen Namensraum.
- Bestehende lokale Konten beginnen nach Einführung ebenfalls ohne Freigaben. Löschen und Neuanlegen eines Kontos übernimmt keine alten Freigaben.
- Die Modi `none` und `token` ersetzen keine persönliche Freigabe und erlauben deshalb keinen KI-/Tableau-API-Zugriff. Vor Nutzung muss im Admin-Bereich `local` oder `oidc` konfiguriert sein.
- SQLite und PostgreSQL speichern die Freigaben dauerhaft. Bei nicht lesbarem Freigabestatus bleibt der Zugriff gesperrt.
- `GET /api/session` liefert der angemeldeten Extension `{ user, access: { ai, tableauApi } }`. Admins verwalten Identitäten über `GET /api/admin/user-access` und `PUT /api/admin/user-access/:id` mit `{ ai, tableauApi }`.
- Admin-Konfiguration und Admin-Verbindungstests behalten ihren eigenen Zugriffsschutz; Benutzerfreigaben vergeben keine Administrationsrechte.
