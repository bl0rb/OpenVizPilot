# Lizenz-Heartbeat (Enterprise)

Eine Installation mit gültiger Enterprise-Lizenz meldet sich **einmal täglich**
bei WerkWorks. Das ist Bestandteil der Lizenz und in der Software nicht
abschaltbar. Die Core-Edition sendet nie etwas: Ohne gültige Lizenz gibt es
keinen Heartbeat.

Der sendende Code ist [`../server/src/telemetry.ts`](../server/src/telemetry.ts)
— lesbar, prüfbar, und er sendet genau das, was diese Seite beschreibt.

## Was übertragen wird

```json
{
  "schema": "openvizpilot-heartbeat-v1",
  "installationId": "3f2b1c44-…",
  "license": "<der eingetragene Lizenzschlüssel>",
  "version": "0.3.0-rc.1",
  "sentAt": "2026-09-03T18:00:00.000Z",
  "usage": { "activeUsers30d": 12, "dashboards": 4 }
}
```

`installationId` ist eine beim ersten Start zufällig erzeugte UUID, die in der
Datenbank der Installation liegt; sie hängt an keinem Hostnamen und an keinem
Konto. `activeUsers30d` und `dashboards` sind zwei Zahlen aus den letzten 30
Tagen. Lizenznehmer, Tier, Features und Laufzeit stehen **nicht** im Payload —
sie werden auf der Gegenseite aus der geprüften Signatur des Lizenzschlüssels
gelesen. Eine Installation kann sich damit keine Lizenz andichten, die sie
nicht hat.

## Was nie übertragen wird

- Fragen, Antworten oder Dashboard-Daten
- Namen von Dashboards, Arbeitsblättern oder Feldern
- Namen, Kennungen oder Pseudonyme einzelner Anwender
- Hostnamen, Konfigurationswerte, IP-Adressen

Die Zahl aktiver Anwender entsteht aus den nicht umkehrbaren, installationsweit
erzeugten Pseudonymen der anonymen Nutzungsstatistik. Übertragen wird allein
deren **Anzahl**, nie die Pseudonyme selbst.

## Verhalten im Betrieb

Der Versand läuft im Hintergrund und blockiert keine Anfrage. Scheitert er,
bleibt das folgenlos: Die Installation arbeitet unverändert weiter, alle
lizenzierten Funktionen bleiben verfügbar, der nächste Versuch kommt am
Folgetag. Bei mehreren Replicas sendet nur eine — der Sendeslot wird in der
gemeinsamen Datenbank beansprucht. Ohne Datenbank (`memory.enabled=false`) gibt
es keinen Heartbeat.

Die Gegenstelle ist fest `https://werkworks.de/ovp-lizenz/heartbeat.php` und
bewusst nicht konfigurierbar; der Heartbeat gehört zur Lizenz, nicht zu den
Betriebseinstellungen. Für die Firewall: ausgehend HTTPS auf `werkworks.de`,
Port 443.

Der aktuelle Stand steht in der Admin-UI unter **„Telemetrie"**: aktiv oder
nicht, Gegenstelle, Intervall, letzter erfolgreicher Versand und die Liste
dessen, was gesendet bzw. nie gesendet wird — aus derselben Quelle, die auch
sendet.

## Text für Vertrag und Lizenzdokument

Zum Übernehmen in den Enterprise-Vertrag. Platzhalter in `[eckigen Klammern]`
ausfüllen; die datenschutzrechtliche Einordnung gehört vor dem ersten Einsatz
in fachkundige Hände.

> **§ [x] Lizenzprüfung (Heartbeat)**
>
> (1) Die Software meldet sich mit gültigem Enterprise-Lizenzschlüssel einmal
> täglich bei [Firmierung], um Bestand und Laufzeit der erteilten Lizenzen zu
> prüfen. Die Meldung ist Bestandteil der Enterprise-Lizenz und in der Software
> nicht abschaltbar. Die Core-Edition sendet keine Meldung.
>
> (2) Übermittelt werden ausschließlich: der vom Lizenzgeber ausgestellte,
> signierte Lizenzschlüssel (er enthält Lizenznehmer, Lizenz-ID, Tier,
> freigeschaltete Funktionen und Laufzeit); eine bei der Erstinbetriebnahme
> zufällig erzeugte Kennung der Installation (UUID, ohne Bezug zu Hostnamen,
> Konten oder Personen); die eingesetzte Produktversion; der Zeitpunkt der
> Meldung; sowie zwei Zahlen: die Anzahl aktiver Anwender der letzten 30 Tage
> und die Anzahl der Dashboards, in denen die Software genutzt wurde.
>
> (3) Nicht übermittelt werden insbesondere: Inhalte von Fragen oder Antworten,
> Dashboard-Daten, Namen oder Bezeichnungen von Dashboards, Arbeitsblättern
> oder Feldern, Namen, Kennungen oder Pseudonyme einzelner Anwender, Hostnamen,
> Konfigurationswerte sowie IP-Adressen. Der Lizenzgeber protokolliert bei der
> Entgegennahme der Meldung weder IP-Adressen noch User-Agents.
>
> (4) Die Zahl der aktiven Anwender wird aus nicht umkehrbaren,
> installationsweit erzeugten Pseudonymen gebildet; übermittelt wird allein
> deren Anzahl, nicht die Pseudonyme selbst.
>
> (5) Der Lizenzgeber speichert je Installation einen Datensatz mit den unter
> Absatz 2 genannten Angaben sowie dem Zeitpunkt der ersten und der letzten
> Meldung. Ein Verlauf einzelner Meldungen wird nicht geführt; jede neue
> Meldung überschreibt den vorherigen Stand. Die Daten werden ausschließlich
> zur Prüfung und Verwaltung der Lizenz sowie zur Information über auslaufende
> Lizenzen verwendet und [Aufbewahrungsdauer].
>
> (6) Der Lizenznehmer kann den Umfang der Meldung jederzeit in der
> Administrationsoberfläche der Software im Abschnitt „Telemetrie" einsehen.
>
> (7) Eine ausbleibende oder fehlgeschlagene Meldung beeinträchtigt den Betrieb
> der Software nicht; freigeschaltete Funktionen bleiben für die Laufzeit der
> Lizenz verfügbar.

Kurzfassung für das Lizenzdokument, das mit dem Schlüssel ausgeliefert wird:

> **Lizenzprüfung.** Diese Installation meldet sich mit gültigem
> Enterprise-Schlüssel einmal täglich an `werkworks.de`. Übertragen werden
> allein der Lizenzschlüssel, eine zufällige Kennung dieser
> Installation, die Produktversion, der Zeitpunkt sowie zwei Zahlen (aktive
> Anwender der letzten 30 Tage, Anzahl Dashboards). Inhalte, Dashboard-Namen,
> Anwendernamen und IP-Adressen werden nicht übertragen und nicht gespeichert.
> Den genauen Umfang und den letzten Sendezeitpunkt zeigt die
> Administrationsoberfläche unter „Telemetrie". Fällt die Meldung aus, läuft
> die Software unverändert weiter. Für die Firewall: ausgehend HTTPS auf
> `werkworks.de` (Port 443).

## Häufige Rückfragen

- **Personenbezug**: Übermittelt werden der Name des Lizenznehmers (juristische
  Person) und eine Zufalls-UUID der Installation. Zu einzelnen Anwendern geht
  nichts hinaus — auch keine Pseudonyme, nur deren Anzahl.
- **Zweck**: Lizenzbestand und Laufzeit, nicht Nutzungsanalyse. Es gibt keinen
  Verlauf, aus dem sich Nutzungsprofile ableiten ließen — je Installation
  existiert genau ein Datensatz mit dem letzten Stand.
- **Kein Rückkanal**: Die Gegenstelle antwortet nur mit `ok` und dem Hinweis,
  ob die Lizenz abgelaufen ist. Sie kann die Installation nicht steuern, keine
  Funktionen abschalten und keine Daten nachfordern.
