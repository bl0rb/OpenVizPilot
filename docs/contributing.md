# Mitwirken

Regeln für jede Änderung und Checklisten für die häufigsten Aufgaben. Agenten lesen vorher `AGENTS.md`.

- **Sprache und Stack:** TypeScript (strict, `tsconfig.base.json` mit `noUncheckedIndexedAccess`), ESM, npm-Workspaces, Node 24. Server auf Hono, Extension auf Preact, Schemas mit zod. Neue Abhängigkeiten nur, wenn vorhandene nicht reichen.
- **Lizenz:** Alles außerhalb von `ee/` steht unter [PolyForm Noncommercial 1.0.0](../LICENSE), `ee/` unter der proprietären Enterprise-Lizenz. Lizenzpflichtige Logik gehört nach `ee/`, nie nach `packages/`.
- **Datenisolation:** Keine Tableau-Identität in der Middleware, keine Inhalte in Logs, Dashboard-Änderungen nur auf Klick, Lizenz- und Freigabeprüfung serverseitig. Siehe *Datenisolation und Sicherheit* in `AGENTS.md` und die Sicherheitsgrenzen in [architecture.md](architecture.md#7-sicherheitsgrenzen).
- **Tests:** Jede Verhaltensänderung kommt mit Vitest-Tests im `test/`-Ordner des Workspace. Änderungen an Auth, Freigaben, Lizenz oder Datenzugriff testen auch den abgelehnten Fall.
- **Prüfen:** `npm run typecheck`, `npm test` und `npm run build` müssen grün sein, siehe [development.md](development.md#tests-und-prüfungen).
- **Texte:** Sichtbare Texte der Extension in `packages/shared/src/i18n.ts`, immer für `de` und `en`. Doku unter `docs/` und Code-Kommentare auf Deutsch, `README.md` auf Englisch. Kommentare erklären das *Warum*.
- **UI:** Gestaltung nach [UI-SPEC.md](UI-SPEC.md). Änderungen im Mock-Modus (`npm run dev:demo`) ansehen; bei PRs Screenshots vorher/nachher anhängen.
- **Commits:** klein und fokussiert, mit klarer Betreffzeile, z. B. „Extension: statischer Demo-Modus“. Abhängigkeits-Updates kommen über Dependabot.

## Ein Dashboard-Tool hinzufügen

1. **Schema:** Argumente als zod-Schema in `toolArgSchemas` in `packages/shared/src/tools.ts`. Obergrenzen für Zeilen und Gruppen als benannte Konstanten daneben.
2. **Definition:** Eintrag in `toolDefinitions` in derselben Datei. Die Beschreibung ist das, was das LLM liest: wann das Tool passt, was es zurückgibt, welche Grenzen gelten.
3. **Executor:** Funktion gleichen Namens in `executors` in `packages/extension/src/tools/executors/index.ts`. Der Typ `ToolExecutors` erzwingt das. Der Executor liest nur über die Extensions API, wirft nie und gibt Fehler als Text zurück. Das Ergebnis wird auf `MAX_TOOL_RESULT_CHARS` gekürzt (`registry.ts`).
4. **Prompt:** Wenn das Modell das Tool nur mit Anleitung richtig nutzt, den Abschnitt in `packages/server/src/system-prompt.ts` ergänzen.
5. **Mock und Demo:** Das Mock-Dashboard (`packages/extension/src/mock/tableau-mock.ts`) muss liefern, was das Tool liest. Bei Bedarf das Mock-LLM (`packages/server/scripts/mock-litellm.mjs`) oder den Demo-Responder (`packages/extension/src/demo/`) erweitern.
6. **Tests:** Schema (`packages/shared/test/`), Executor mit Mock-Dashboard (`packages/extension/test/executors.test.ts`), dazu ungültige Argumente und leere Daten.
7. **Doku:** Tool-Anzahl und Beschreibung in `README.md` › What it does nachziehen.

## Eine Konfigurationsvariable hinzufügen

1. Feld im zod-Schema in `packages/server/src/env.ts`, Name `OVP_*`, mit sinnvollem Standardwert. Leere Werte gelten als nicht gesetzt (`emptyAsUnset`).
2. Eintrag mit deutschem Kommentar in `.env.example`.
3. Im Helm-Chart `charts/openvizpilot`: Wert in `values.yaml`, Übergabe in `templates/deployment.yaml`, Secrets über `templates/env-secret.yaml`. Fehlende Pflichtwerte lassen das Rendern scheitern, siehe die Negativprüfungen in `pr-ci.yml`.
4. Falls für Betreiber relevant: [admin-deployment.md](admin-deployment.md) oder die passende Feature-Doku.
5. Test in `packages/server/test/env.test.ts`.

Umbenennen nur mit Rückfall: alter Name in `LEGACY_ENV_NAMES` (`env.ts`), damit bestehende Installationen weiterlaufen.

## Eine Enterprise-Funktion hinzufügen (nur Enterprise-Repo)

1. **Code** unter `ee/server/src/` bzw. `ee/extension/src/`, exportiert über `ee/server/src/index.ts` bzw. `ee/extension/src/index.ts`. Eigene Tabellen legt das Modul selbst auf der Verbindung an, die der Kern hält.
2. **Feature-Schlüssel:** neue Funktion in `EE_FEATURES` und `EE_FEATURE_LABELS` (`ee/server/src/license.ts`). Die Prüfung läuft serverseitig vor jeder Ausführung. Den Produktkatalog des Lizenzgenerators außerhalb dieses Repos ebenfalls anpassen (`ee/README.md` › Lizenzformat).
3. **Stub:** Alles, was der Kern davon importiert, in `ee-stub/server/src/index.ts` bzw. `ee-stub/extension/src/index.ts` mit gleicher Signatur und lizenzfreiem Verhalten (402, leere Ergebnisse, Feature aus). Gemeinsame Abhängigkeiten in `ee-stub/package.json` mit derselben Version wie in `ee/package.json`.
4. **Tests** in `ee/test/`, auch für fehlende Lizenz, fehlende Freigabe und fehlende Einwilligung.
5. **Prüfen:** `scripts/core-export.sh /tmp/ovp-core` muss grün sein.
6. **Doku:** eigene Seite unter `docs/` oder Abschnitt in [enterprise.md](enterprise.md); Modultabelle in `ee/README.md`. Neue rein interne Dateien außerhalb von `ee/` in die Ausschlussliste von `scripts/core-export.sh`, sonst landen sie im öffentlichen Repo.

## Einen Text in der Extension ändern oder hinzufügen

1. Schlüssel in `packages/shared/src/i18n.ts`, in `de` **und** `en`. Platzhalter wie in den vorhandenen Einträgen.
2. Im Code nur über `t(...)` verwenden, keine festen Strings in Komponenten.
3. Betrifft es Endanwender: das [Wiki](https://github.com/bl0rb/OpenVizPilot/wiki) (de/en) prüfen.
