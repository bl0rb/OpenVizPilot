import { describe, expect, it } from 'vitest';
import { adminPageHtml } from '../src/admin-page';

/**
 * Die Admin-UI ist ein TS-Template-String mit Inline-JS: ein einziges
 * falsches Escaping (z. B. "\n" statt "\\n" im Template) macht die ganze
 * Seite tot — dieser Test kompiliert das ausgelieferte Skript.
 */
describe('admin page inline script', () => {
  it('parses as JavaScript', () => {
    const match = /<script>([\s\S]*)<\/script>/.exec(adminPageHtml);
    expect(match).not.toBeNull();
    expect(() => new Function(match![1]!)).not.toThrow();
  });

  it('contains the sections the admin API serves', () => {
    for (const id of ['commands-body', 'playbook-commands-body', 'models-body', 'trex-url', 'dashboard-stats-body', 'stats-grid']) {
      expect(adminPageHtml, id).toContain(`id="${id}"`);
    }
  });
});
