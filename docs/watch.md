# Watch — Dashboards beobachten und melden

> **Enterprise:** Lizenz-Feature `watch`, zusätzlich zu `serverData`, `tableauServer` und `sso`
> (siehe [docs/enterprise.md](enterprise.md)). Baut auf dem serverseitigen Datenzugriff auf
> Tableau-Views außerhalb des Dashboards auf (siehe
> [docs/admin-deployment.md](admin-deployment.md#serverseitiger-datenzugriff-tableau-views-außerhalb-des-dashboards)).

## Zielbild

Ein Nutzer sagt im Chat „Sag mir Bescheid, wenn die Marge unter 20 % fällt“ und bestätigt den
Vorschlag in einer Karte. Die Middleware wertet die Regel nach Zeitplan **im Namen des Nutzers**
aus — mit denselben vier Hürden wie beim serverseitigen Datenzugriff, bei jedem einzelnen Lauf
erneut geprüft —, erkennt den Übergang in den Alarmzustand und stellt eine kurze Meldung zu
(Webhook, Microsoft Teams oder E-Mail) mit einem Link zur View. Prinzip: **die KI schlägt vor, der
Mensch bestätigt** — das Chat-Tool legt nie selbst eine Regel an.

## Voraussetzungen

Jeder einzelne Lauf prüft erneut:

1. Lizenz-Feature `watch` (setzt `serverData`, `tableauServer` und `sso` voraus).
2. Freigabe „Serverdaten“ der Regel-Eigentümerin/des Regel-Eigentümers unter „Benutzerzugriff“.
3. Deren Einwilligung zum serverseitigen Datenzugriff.
4. Site-Schalter „Serverseitige Daten erlauben“.

Scheitert eine Hürde, wird die Regel automatisch deaktiviert (`enabled=false`) mit einem
Klartext-Grund (z. B. „Freigabe ‚Serverdaten‘ wurde entzogen“) — es erfolgt keine weitere
Zustellung, bis jemand die Regel manuell wieder aktiviert (und die Hürde behoben ist).

## Wie eine Regel entsteht

- **Über den Chat**: Wer „sag mir Bescheid / beobachte / melde dich, wenn …“ schreibt, bekommt
  eine Bestätigungskarte mit allen Feldern editierbar (Name, Schwelle, Zeitplan, Kanal). Das Modell
  sucht die View vorher über `tableau_server_search` und legt **nichts selbst an** — erst ein Klick
  auf „Regel anlegen“ sendet `POST /api/watch/rules`.
- **In den Einstellungen**: Die Extension zeigt die eigenen Regeln (Name, View, Bedingung,
  Zeitplan, Kanal, Status, letzter Wert) mit Ein/Aus-Schalter, „Jetzt testen“ und Löschen. Ein
  vollständiges Anlege-Formular gibt es in v1 nicht — neue Regeln entstehen über den Chat-Vorschlag.

Jede Regel bezieht sich auf **eine** View (per LUID), eine Kennzahl (Spalte + Aggregat:
Summe/Durchschnitt/Min/Max/Anzahl/letzter Wert), optional einen Zeilenfilter (`Spalte = Wert`,
angewendet nach dem Lesen — kein Tableau-`vf_`-Parameter) und eine Bedingung (`unter`/`über` einem
Schwellwert oder `Änderung in %` gegenüber dem vorherigen Lauf).

## Zeitpläne

`15m` · `1h` · `6h` · `24h` · `weekly` (mit Wochentag + Stunde), Zeitzone als IANA-Name (Default
`UTC`). Ein Scheduler-Tick läuft jede Minute; in einem Deployment mit mehreren Replicas übernimmt
genau eine Instanz die Auswertung (Leader-Claim in der Datenbank). Je Tick werden höchstens 20
fällige Regeln nacheinander ausgewertet, mit 45 Sekunden Timeout je Regel — bei mehr fälligen
Regeln folgen die übrigen im nächsten Tick.

## Auswertung

Die Daten kommen über denselben serverseitigen Lesepfad wie beim manuellen `tableau_view_data`
(begrenzte Summary-Daten, mit den Tableau-Berechtigungen der Regel-Eigentümerin/des
Regel-Eigentümers) und erzeugen automatisch eine Audit-Zeile (`purpose: watch:<ruleId>`). Zeilen
werden **nicht gespeichert** — nur der zuletzt berechnete Wert (`lastValue`).

- **Alarm**: bei Übergang von „normal“ zu „auffällig“, danach erneut, wenn der Zustand seit
  mindestens 24 Stunden ununterbrochen auffällig bleibt (keine Dauerbeschallung bei jedem Tick).
- **Entwarnung**: eine kurze Meldung beim Rücksprung in den Normalzustand — nur, wenn zuvor
  alarmiert wurde.
- **Fehler**: bei einem fehlgeschlagenen Lauf zählt ein Fehlerzähler hoch; nach 5 Fehlern in Folge
  wird die Regel automatisch deaktiviert (mit Grund) statt endlos weiterzuversuchen.

Der Alert-Text (Deutsch, höchstens 600 Zeichen) nennt Regelname, View, Wert gegen Schwelle, den
Zeitpunkt, einen Link „Analyse öffnen“ und den Hinweis, in wessen Namen gelesen wurde — **nie**
Rohzeilen der View.

## Kanäle

- **Webhook**: `POST` mit JSON-Payload, ausschließlich HTTPS, 10 Sekunden Timeout, keine
  Weiterleitungen. Das Ziel muss zur admin-verwalteten Host-Allowlist passen (exakter Host oder
  Suffix, Default `webhook.office.com` und `logic.azure.com`) und darf kein privates Netz sein
  (RFC1918, CGNAT, `localhost`, Link-Local, IPv6-ULA — dieselbe Adressprüfung wie beim
  Tableau-Server-Transport; die Allowlist wird bei jeder Zustellung erneut geprüft).
- **Microsoft Teams**: ein Incoming Webhook (gleiche Host-Regel wie oben) mit einer Adaptive Card
  (Titel, Fakten für Wert/Schwelle/Zeitpunkt, Button „Analyse öffnen“).
- **E-Mail**: nur wenn die Admin-Einstellung „E-Mail-Versand“ aktiv **und** SMTP konfiguriert ist
  (`OVP_SMTP_URL`, `OVP_SMTP_FROM` — siehe unten). Betreff `[OpenVizPilot] <Regelname>`, Text- und
  einfacher HTML-Teil.

Zustellung erfolgt mit bis zu vier Versuchen (drei Wiederholungen mit Backoff 1/5/15 Minuten);
scheitern alle, gilt der Alert als `failed`. Wird eine Regel zwischenzeitlich deaktiviert oder
gelöscht, werden offene Zustellungen verworfen (`failed`, Text gelöscht). Bei erfolgreicher Zustellung wird der Alert-Text sofort gelöscht.

## Was gespeichert wird — und wie lange

- **Nie gespeichert**: die gelesenen Zeilen selbst — nur der zuletzt berechnete Wert je Regel.
- **Alert-Text**: gelöscht, sobald zugestellt (`delivered`); bei endgültigem Fehlschlag (`failed`)
  bleibt er höchstens 7 Tage erhalten (zur Fehlersuche), dann wird auch er gelöscht.
- **Alerts insgesamt**: 90 Tage, danach automatisch gelöscht — wie das Audit-Log des
  serverseitigen Datenzugriffs.
- **Audit**: jeder Lesevorgang einer Regel erzeugt eine Audit-Zeile wie beim manuellen
  `tableau_view_data` (Zeitpunkt, Pseudonym, Site, View, Zeilenzahl, Dauer, Status), einsehbar im
  Admin unter „Tableau Server“.

## Admin-Einstellungen

Unter „Watch“ (Bereich Betrieb): globaler Ein/Aus-Schalter, Webhook-Host-Allowlist (eine Zeile je
Host), E-Mail-Versand ein/aus (mit Hinweis, ob SMTP aktuell konfiguriert ist), Limits
(`maxRulesPerUser`, Default 20; `minIntervalMinutes`, Default 15). Eine Tabelle zeigt alle Regeln
aller Nutzer (Name, Owner, View, Bedingung, Zeitplan, Kanal, Status, letzter Lauf, letzter Wert,
Fehler) mit einem „Deaktivieren“-Knopf je Regel.

## Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `OVP_WATCH_ENABLED` | Globaler Schalter für die Watch-Engine (Default an) — zusätzlich zur Admin-Einstellung „global an/aus“ und zur Lizenz. |
| `OVP_SMTP_URL` | SMTP-URL für den E-Mail-Kanal, z. B. `smtps://user:pass@mail.example.com:465`. Ohne sie bleiben Webhook und Microsoft Teams unverändert nutzbar. |
| `OVP_SMTP_FROM` | Absenderadresse für Watch-E-Mail-Alerts. |

Im Helm-Chart: `app.watchEnabled` sowie `smtp.urlSecret.{existingSecret,key}` und `smtp.from`
(siehe Vault-Tabelle im [README](../README.md#configuration-from-a-vault-helm)).
