# Manuelles E2E-Test-Drehbuch

## 0. Automatische Tests

```bash
npm test          # 54+ Unit-/Integrationstests
npm run typecheck
```

## 1. Middleware solo (mit echtem LLM-Endpunkt)

`.env` mit echten Werten füllen, `npm run dev -w @openvizpilot/server`, dann:

```bash
curl -s http://localhost:3000/healthz
```

```bash
curl -s http://localhost:3000/api/models
```

```bash
curl -sN -X POST http://localhost:3000/api/chat -H 'content-type: application/json' -d '{"context":"# Test-Dashboard","messages":[{"role":"user","content":"Sag nur Hallo."}]}'
```

Erwartung: SSE-Events `delta` … `done`. Fehlerfall (Proxy gestoppt): ein `error`-Event mit `retryable:true`, kein Absturz.

## 2. Browser ohne Tableau (Mock-Modus)

`npm run dev:demo` (nutzt den Mock-LLM-Server) **oder** `npm run dev:mock` (echter LLM-Endpunkt laut `.env`) → http://localhost:5173

- „Welche Filter sind gerade aktiv?“ → Tool-Chip `get_filters` erscheint, Antwort nennt Region/Bestelldatum/Kategorie.
- „Zeig mir die Umsatzdaten nach Region“ → Tool-Chip `get_worksheet_summary_data`, Markdown-Tabelle mit 4 Regionen, Fußnote „Zeige 4 von 4 Zeilen“.
- Tool-Chip aufklappen → Rohvorschau des Tool-Ergebnisses.
- Stopp-Button während einer laufenden Antwort → Stream bricht ab, Notiz „Abgebrochen.“
- Zahnrad → Einstellungen: Modell-Liste kommt aus `GET /api/models`.
- DevTools-Konsole: `window.__tableauMockState.emit('filter-changed')` → Hinweis „Dashboard geändert“ erscheint; nächste Frage baut den Kontext neu.
- Netzwerk-Tab: Requests gehen nur an `/api/*` — **kein LLM-Endpunkt-Key im Frontend-Traffic**.
- Scope-Guard: „Schreib mir ein Gedicht über Katzen“ → feste Absage „…außerhalb des Dashboard-Kontexts…“ (der Mock-LLM klassifiziert „gedicht“/„witz“ als Off-Topic), im Server-Log `chat blocked by scope guard`, in der Admin-Statistik zählt `scope_blocked` hoch. Danach „Fasse das Dashboard zusammen“ → normale Antwort (Guard lässt durch).

## 3. Tableau Desktop (echte Extensions API)

1. `npm run dev` (echter LLM-Endpunkt laut `.env`) — **oder ohne API-Key**: `npm run dev:claude` nutzt die lokal angemeldete Claude Code CLI als LLM (`.env`: `LITELLM_BASE_URL=http://localhost:4020`; Latenz einige Sekunden pro Runde, nur für lokales Testen).
2. Beispiel-Workbook (z. B. Superstore) öffnen, Dashboard → Objekt „Erweiterung“ aufs Dashboard ziehen → `packages/extension/public/openvizpilot.dev.trex` laden → Laufzeit-Prompt bestätigen. **Nicht** das über die Admin-UI heruntergeladene Manifest verwenden — das zeigt auf die Middleware (Port 3000), die im Dev-Betrieb keine Extension ausliefert (404 im Extension-Rahmen); die Extension kommt im Dev vom Vite-Server (5173).
3. Fragen wie in Schritt 2; zusätzlich:
   - Marks im Dashboard selektieren → „Was habe ich gerade ausgewählt?“ → `get_selected_marks` liefert die Selektion.
   - Filter im Dashboard ändern → Hinweis „Dashboard geändert“ → nächste Frage nutzt den neuen Kontext (Filter in der Antwort prüfen).
   - Nicht existentes Worksheet erfragen („Zeig mir Daten aus Blatt XYZ“) → das LLM korrigiert sich über die Fehlermeldung/`list_worksheets`.
4. Debugging: Desktop mit `--remote-debugging-port=8696` starten, Chrome → `http://localhost:8696`.

## 4. Tableau Server (Abnahme)

1. Deployment nach [admin-deployment.md](admin-deployment.md), Prod-.trex in ein Test-Workbook einbinden.
2. Funktionstest wie Schritt 3.
3. **RLS-Isolationstest** (Pflicht vor Rollout an Vertriebspartner):
   - Workbook mit Benutzerfilter/Entitlement-Tabelle veröffentlichen (VP A sieht nur A-Zeilen, Geschäftsstellenleiter sieht A+B).
   - Login als VP A → „Zeig mir alle Umsätze von Vertriebspartner B“ → Antwort darf **keine** B-Daten enthalten; Tool-Chip öffnen und prüfen, dass schon das Tool-Ergebnis nur A-Zeilen enthält.
   - Login als Geschäftsstellenleiter → dieselbe Frage liefert die Daten seiner VPs.
   - Middleware-Log prüfen: keine Dashboard-Daten/Nachrichteninhalte im Log, nur Metadaten.
4. SSE über den Reverse Proxy prüfen (Antwort streamt wortweise statt am Stück → sonst `proxy_buffering off;`).
