import { z } from 'zod';

/**
 * Slash-Befehle: deutsche Prompt-Presets nach dem Playbook-Muster
 * (Ziel → Vorgehen → Format). Typen, Validierung und die eingebauten
 * Defaults leben hier zentral, weil sowohl der Server (Admin-Verwaltung,
 * server/routes/admin.ts, server/routes/commands.ts) als auch die Extension
 * (Fallback, extension/src/chat/commands-client.ts) sie brauchen.
 *
 * Die Expansion selbst (Platzhalter → fertiger Prompt) bleibt in der
 * Extension (chat/slash-commands.ts) — sie arbeitet rein clientseitig auf
 * einer vom Aufrufer übergebenen Liste (server-geladen oder Defaults).
 */

export const MAX_SLASH_COMMANDS = 20;
export const MAX_SLASH_COMMAND_DESCRIPTION_CHARS = 80;
export const MAX_SLASH_COMMAND_ARG_HINT_CHARS = 40;
export const MIN_SLASH_COMMAND_TEMPLATE_CHARS = 10;
export const MAX_SLASH_COMMAND_TEMPLATE_CHARS = 1500;

export const slashCommandSchema = z.object({
  /** Name ohne führenden Slash — Kleinbuchstaben, Ziffern, Bindestrich. */
  name: z.string().regex(/^[a-z0-9-]{1,32}$/, 'Nur a-z, 0-9 und "-", max. 32 Zeichen'),
  /** Kurzbeschreibung fürs Menü. */
  description: z.string().min(1).max(MAX_SLASH_COMMAND_DESCRIPTION_CHARS),
  /** Platzhalter-Hinweis für Argumente (nur Anzeige). */
  argHint: z.string().max(MAX_SLASH_COMMAND_ARG_HINT_CHARS).optional(),
  /** Prompt-Template; {{args}} wird durch die Eingabe nach dem Befehl ersetzt. */
  template: z.string().min(MIN_SLASH_COMMAND_TEMPLATE_CHARS).max(MAX_SLASH_COMMAND_TEMPLATE_CHARS),
});

export type SlashCommand = z.infer<typeof slashCommandSchema>;

/** Liste von Slash-Befehlen — höchstens MAX_SLASH_COMMANDS, Namen eindeutig. */
export const slashCommandListSchema = z
  .array(slashCommandSchema)
  .max(MAX_SLASH_COMMANDS)
  .superRefine((commands, ctx) => {
    const seen = new Set<string>();
    commands.forEach((c, i) => {
      if (seen.has(c.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Doppelter Befehlsname: ${c.name}`,
          path: [i, 'name'],
        });
      }
      seen.add(c.name);
    });
  });

/** Eingebaute Defaults, verwendet solange der Server keine eigenen konfiguriert hat. */
export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'zusammenfassung',
    description: 'Management-Summary des Dashboards',
    template:
      'Ziel: Eine Management-Zusammenfassung dieses Dashboards. Vorgehen: Lies die zentralen Kennzahlen und aktiven Filter; prüfe die wichtigsten Worksheets gezielt per Tool. Format: 3–5 Kernaussagen als Aufzählung, danach eine kompakte Kennzahlen-Tabelle, je Zahl mit Quellen-Worksheet.',
  },
  {
    name: 'auffaelligkeiten',
    description: 'Top-3-Auffälligkeiten mit Drilldown',
    template:
      'Ziel: Die drei größten Auffälligkeiten in den Daten finden (Ausreißer, ungewöhnliche Verhältnisse, Top-/Flop-Performer). Vorgehen: Verschaffe dir per Tools einen Überblick und drille mit aggregate_summary_data gezielt nach (Gruppierung nach den relevanten Dimensionen). Format: Pro Auffälligkeit eine Überschrift, die Belegzahlen mit Quelle und eine Einschätzung, ob Handlungsbedarf besteht.',
  },
  {
    name: 'vergleich',
    description: 'Zwei Segmente/Regionen/Zeiträume vergleichen',
    argHint: '<A> <B>',
    template:
      'Ziel: Einen belastbaren Vergleich von {{args}} erstellen. Vorgehen: Ermittle mit aggregate_summary_data die relevanten Kennzahlen je Vergleichsgruppe; achte auf aktive Filter. Format: Vergleichstabelle (Kennzahl · A · B · Differenz absolut/%), danach 2–3 Sätze Einordnung, was den Unterschied treibt.',
  },
  {
    name: 'top',
    description: 'Top-N-Analyse einer Dimension',
    argHint: '<N> <Dimension>',
    template:
      'Ziel: Eine Top-Analyse: {{args}}. Vorgehen: Nutze aggregate_summary_data mit passender Gruppierung und sortiere nach der wichtigsten Kennzahl. Format: Rangliste als Tabelle mit Anteil am Gesamtwert, darunter eine Aussage zur Konzentration (z. B. wie viel die Top-Einträge ausmachen).',
  },
  {
    name: 'massnahmen',
    description: 'Priorisierte Handlungsempfehlungen',
    template:
      'Ziel: Konkrete nächste Schritte aus den Daten ableiten. Vorgehen: Identifiziere per Tools die größten Chancen und Problemfelder (schwache Segmente, auffällige Entwicklungen). Format: Maximal 3 Empfehlungen, priorisiert, jede mit der Datengrundlage (Zahl + Quelle) und dem erwarteten Effekt. Keine Empfehlung ohne Beleg aus diesem Dashboard.',
  },
  {
    name: 'bericht',
    description: 'Formatierter Bericht zum Kopieren',
    template:
      'Ziel: Ein versandfertiger Kurzbericht zu diesem Dashboard. Vorgehen: Kennzahlen und Besonderheiten per Tools erheben. Format: Überschrift, Absatz Gesamtlage, Kennzahlen-Tabelle, Abschnitt „Auffälligkeiten", Abschnitt „Empfehlung" — sachlicher Berichtston, alle Zahlen mit Quellen-Worksheet. Nenne am Ende die aktiven Filter als Datenstand.',
  },
  {
    name: 'datenqualitaet',
    description: 'Lücken und Filter-Effekte erklären',
    template:
      'Ziel: Die Datenqualität dieses Dashboards einschätzen. Vorgehen: Prüfe per Tools auffällige Lücken (leere Werte, fehlende Gruppen) und ob aktive Filter oder Parameter Daten ausblenden. Format: Liste der Befunde mit wahrscheinlicher Ursache und dem Hinweis, was der Betrachter beim Interpretieren beachten sollte.',
  },
];
