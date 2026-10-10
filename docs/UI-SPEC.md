# UI-Spezifikation OpenVizPilot

Verbindliche Vorgaben für Oberfläche, Elemente, Texte und Design. Bei Widerspruch
zwischen Code und diesem Dokument gilt dieses Dokument — Abweichungen im Code sind
Bugs oder offene Punkte (siehe [Offene Punkte](#offene-punkte)).

Pflege-Regeln:

* `TODO` = noch nicht entschieden, bitte nicht raten.
* Texte immer mit i18n-Key angeben (`packages/shared/src/i18n.ts`, Sprachen `de` + `en`).
* Screenshots/Skizzen unter `docs/images/ui/` ablegen und hier verlinken.
* Pro Element nur ausfüllen, was vom Standard (Abschnitt 2–4) abweicht.

---

## 1. Oberflächen im Überblick

| Oberfläche | Zielgruppe | Code | Sprache |
|---|---|---|---|
| Tableau-Extension (Chat) | Dashboard-Nutzer | `packages/extension/src/ui/`, `ee/extension/src/` | `de`/`en` über i18n |
| Admin-Portal | Administratoren | `packages/server/src/admin-page.ts`, `ee/server/src/**/admin-ui.ts` | Deutsch (fest im HTML) |

---

## 2. Design-Grundlagen

### 2.1 Farben

**Admin-Portal** (CSS-Variablen in `admin-page.ts`):

| Token | Wert | Verwendung |
|---|---|---|
| `--accent` | `#635bff` | Primäre Aktionen, aktive Navigation |
| `--accent-hover` | `#4a35d6` | Hover primärer Aktionen |
| `--bg` | `#f6f8fb` | Seitenhintergrund |
| `--surface` | `#ffffff` | Karten, Dialoge |
| `--border` | `#e3e8ef` | Rahmen, Trenner |
| `--text` | `#1a1f36` | Fließtext |
| `--text-muted` | `#5b6470` | Hilfetexte, Metadaten |
| `--graphite` | `#0d0f16` | Sidebar |
| `--danger` / `--danger-bg` | `#b3261e` / `#fdecea` | Fehler, destruktive Aktionen |
| `--ok-bg` | `#eaf3ec` | Erfolgsmeldungen |
| `TODO` | | Warnung, Info, Enterprise-Badge |

**Tableau-Extension**: übernimmt Schrift und Textfarbe aus der Workbook-Formatierung
(`--ovp-*`, gesetzt in `tableau/formatting.ts`). Eigene Farben nur für:

| Zweck | Wert | Anmerkung |
|---|---|---|
| Header-Hintergrund | `#f7f7f7` | |
| Kontext-Hinweis | `#fff6d6` / `#8a6d00` | „Dashboard geändert“ |
| `--accent` | `#1a699e` | Primäraktionen, Fokusring, aktive Schalter (Tokens in `styles.css` `:root`) |
| `--border` / `--border-input` | `#d5d9dd` / `#868e96` | Trenner / Eingabefelder (≥ 3:1) |
| `--text-muted` | `#5f6368` | Hilfetexte |
| `TODO` | | Akzent aus der Workbook-Formatierung übernehmen? |

### 2.2 Typografie

| Stufe | Admin | Extension | Anmerkung |
|---|---|---|---|
| Seitentitel (h1) | `TODO` | – | |
| Abschnitt (h3) | `TODO` | – | |
| Fließtext | `TODO` | `--ovp-font-size`, Standard 13 px | |
| Metadaten | `TODO` | `--fs-meta` = Fließtext − 1 px | |
| Hilfetext / klein | `TODO` | `--fs-small` = Fließtext − 2 px, min. 11 px | |

### 2.3 Abstände, Radien, Schatten

* Abstandsraster: `TODO` (z. B. 4 / 8 / 12 / 16 / 24 px)
* Radius Karten / Buttons / Badges: `TODO`
* Schatten: `TODO`

### 2.4 Icons

* Admin: Lucide-Icons (`adminIcon(...)`). Neue Icons: `TODO` Größe/Strichstärke.
* Extension: Lucide-Pfade als Inline-SVG (`ui/icons.tsx`), 1em, Strich 2, immer `aria-hidden` — keine Unicode-/Emoji-Symbole.

### 2.5 Dark Mode

`TODO` — unterstützt? Wenn ja, Token-Tabelle für dunkel ergänzen.

---

## 3. Komponenten

Pro Komponente: Varianten, Zustände, Regeln. Nur Abweichungen vom Browser-Standard notieren.

### 3.1 Buttons

| Variante | Einsatz | Aussehen | Beispiel |
|---|---|---|---|
| Primär | genau eine Hauptaktion pro Ansicht | `TODO` | „Speichern“ |
| Sekundär | Nebenaktionen | `TODO` | „Abbrechen“ |
| Destruktiv | Löschen, Zurücksetzen | `TODO` | „Auf Env-Defaults zurücksetzen“ |
| Icon | Toolbar, Header | `.btn-icon` | Einstellungen, Abmelden |

Extension: `.btn-primary` (gefüllt `--accent`), `.btn-secondary` (weiß, Rahmen `--border-input`), `.btn-danger` (weiß, rot umrandet).

Zustände: normal · hover · focus (sichtbarer Fokusring: 2 px `--accent`, global per `:focus-visible`) · disabled · lädt (Button-Text, z. B. „Speichert …“)

### 3.2 Formulare

* Label: `TODO` (oben / links)
* Pflichtfeld-Kennzeichnung: `TODO`
* Hilfetext: unter dem Feld, `--text-muted`
* Validierungsfehler: `TODO` (wann: bei Blur / beim Speichern; wo: unter dem Feld)
* Speichern-Feedback: `TODO` (Toast / Inline-Meldung / Button-Text)

### 3.3 Tabellen

* Leere Tabelle: → Empty State (3.6)
* Sortierung / Filter / Paginierung: `TODO`
* Zeilenaktionen: `TODO` (Icons / Menü „…“)

### 3.4 Karten & Abschnitte

* Jede Admin-Ansicht = `section.card` mit Überschrift
* `TODO` Regeln für Unterabschnitte (h3), Schritt-Anleitungen (1 → 2 → 3)

### 3.5 Badges & Status

| Badge | Bedeutung | Farbe |
|---|---|---|
| `EE` / „Enterprise“ | Enterprise-Funktion | `TODO` |
| `TODO` | aktiv / inaktiv / Fehler / ausstehend | `TODO` |

### 3.6 Meldungen & Zustände

| Zustand | Darstellung | Beispieltext (i18n-Key) |
|---|---|---|
| Lädt | `TODO` | `app.registration.loading` |
| Leer | Icon + Satz + nächste Aktion | `TODO` |
| Fehler | `--danger-bg`, Ursache + was tun | `app.registration.unavailable` |
| Erfolg | `--ok-bg` | `TODO` |
| Keine Berechtigung / Lizenz | `TODO` | `app.chat.actionsUnlicensed` |

### 3.7 Dialoge

* Bestätigung vor destruktiven Aktionen: Titel = Frage, Buttons = Verb („Löschen“, nicht „OK“)
* Extension: `<dialog>` (`ConfirmDialog.tsx`), nie `window.confirm` (Tableau-Sandbox). Fokus auf der sicheren Aktion, Esc = Abbrechen.
* Rückfragen innerhalb eines Formulars (z. B. ungespeicherte Änderungen): sichere Aktion primär, destruktive als `.btn-danger`.

---

## 4. Texte & Tonalität

* Anrede: `TODO` (Sie / du / unpersönlich)
* Buttons: Verb im Infinitiv („Speichern“, „Kennzahl anlegen“)
* Fehlermeldungen: Was ist passiert + was kann ich tun. Keine Stacktraces, keine internen IDs.
* Begriffe (einheitlich verwenden):

| Begriff | Bedeutung | Nicht verwenden |
|---|---|---|
| Dashboard-Analyse | Standardanalyse pro Dashboard (Playbook) | `TODO` |
| Kennzahl | Definierte Metrik | `TODO` |
| Middleware | OpenVizPilot-Server | `TODO` |
| `TODO` | | |

---

## 5. Tableau-Extension (Chat)

### 5.1 Layout

```
┌──────────────────────────────────────┐
│ Header: Titel · Kontext-Hinweis · ⧉ ⚙ ⎋ │
├──────────────────────────────────────┤
│ Nachrichtenliste                      │
│  (Starter-Vorschläge wenn leer)       │
├──────────────────────────────────────┤
│ Composer: Modus · Eingabe · Senden    │
└──────────────────────────────────────┘
```

Mindestbreite: `TODO` px (Extension-Zone im Dashboard kann schmal sein)

### 5.2 Ansichten

| Ansicht | Komponente | Wann sichtbar |
|---|---|---|
| Login | `LoginGate.tsx`, `ee/.../LoginPanel.tsx` | nicht angemeldet |
| Zugriff ausstehend | `App.tsx` (`app.access.*`) | angemeldet, noch nicht freigeschaltet |
| Chat | `MessageList.tsx`, `Composer.tsx` | Standard |
| Einstellungen | `SettingsPanel.tsx` | ⚙ im Header |
| Datenfreigabe | `ServerDataConsent.tsx` | vor erstem Serverzugriff (EE) |
| Gespeicherte Abfragen | `SavedQueriesPanel.tsx` | EE |
| Gedächtnis | `MemoryFactsPanel.tsx` | EE |
| Watch | `watch/WatchSettingsPanel.tsx`, `WatchProposalCard.tsx` | EE |

### 5.3 Chat-Modi

| Modus (`ChatMode`) | Label | Beschreibung für Nutzer | Icon |
|---|---|---|---|
| `ask` | `TODO` | `TODO` | `TODO` |
| `investigate` | `TODO` | `TODO` | `TODO` |
| `investigate-estate` | `TODO` | `TODO` | `TODO` |

### 5.4 Elemente (Vorlage — pro Ansicht kopieren)

#### Ansicht: `<Name>`

Skizze: `docs/images/ui/<datei>.png`

| Element | Typ | Text / Label (i18n-Key) | Tooltip / aria-label | Verhalten | Zustände |
|---|---|---|---|---|---|
| Einstellungen | Icon-Button | – | `app.header.settingsTitle` | öffnet Einstellungen | – |
| Verlauf kopieren | Icon-Button | – | `app.header.copyTranscriptTitle` | kopiert Verlauf als Markdown, danach `TODO` Feedback | disabled bei leerem Verlauf |
| `TODO` | | | | | |

---

## 6. Admin-Portal

### 6.1 Layout

* Sidebar links (`--graphite`) mit Gruppen, Workspace rechts mit Gruppen-Label + h1
* Mobil: Sidebar → `<select>` (`#admin-navigation`), Breakpoint `TODO` px
* Enterprise-Bereiche: Badge `EE` in der Navigation, `Enterprise` im Titel

### 6.2 Navigation

| Gruppe | Bereich | Anker | EE | Zweck (ein Satz) |
|---|---|---|---|---|
| Einrichtung | Übersicht | `#overview-admin` | | `TODO` |
| | Lizenz & Aktivierung | `#license-admin` | | `TODO` |
| | Anmeldung | `#auth-admin` | | `TODO` |
| | Tableau Server | `#tableau-server-admin` | ✓ | `TODO` |
| | Modelle | `#models-admin` | | `TODO` |
| Zugriff | Benutzer & Zugriff | `#users-admin` | | `TODO` |
| | MCP-Quellen | `#mcp-admin` | ✓ | `TODO` |
| Inhalte | Slash-Befehle | `#commands-admin` | | `TODO` |
| | Dashboard-Analysen | `#playbooks-admin` | | `TODO` |
| | Kennzahlen | `#metrics-admin` | | `TODO` |
| Betrieb | Tableau-Extension | `#extension-admin` | | `TODO` |
| | Nutzung | `#usage-admin` | | `TODO` |
| | Watch | `#watch-admin` | ✓ | `TODO` |
| | Serverzugriffe | `#tableau-audit-admin` | ✓ | `TODO` |

Ohne Enterprise-Lizenz: EE-Bereiche `TODO` (ausblenden / sichtbar mit Hinweis + Link zu Lizenz).

### 6.3 Bereiche (Vorlage — pro Bereich kopieren)

#### Bereich: `<Name>` (`#<anker>`)

Skizze: `docs/images/ui/<datei>.png`

**Ziel:** Was erledigt der Admin hier in einem Satz?

**Aufbau (von oben nach unten):**

1. `TODO`
2. `TODO`

**Elemente:**

| Element | Typ | Label | Hilfetext / Platzhalter | Validierung | Verhalten |
|---|---|---|---|---|---|
| `TODO` | | | | | |

**Zustände:**

| Zustand | Anzeige |
|---|---|
| Leer | `TODO` |
| Lädt | `TODO` |
| Fehler | `TODO` |
| Nicht lizenziert (EE) | `TODO` |

---

## 7. Barrierefreiheit

* Alle Icon-Buttons mit `aria-label` (Extension: i18n-Key)
* Tastaturbedienung vollständig, sichtbarer Fokus
* Kontrast mindestens WCAG AA (4,5 : 1 für Text)
* `TODO` weitere Vorgaben

---

## Offene Punkte

| # | Thema | Entscheidung | Status |
|---|---|---|---|
| 1 | `TODO` | | offen |
