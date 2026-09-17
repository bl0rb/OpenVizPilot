import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminPageHtml } from '../src/admin-page';
import { createApp } from '../src/app';
import { loadEnv } from '../src/env';

describe('admin presentation', () => {
  it('gates dashboard editing on a selection and guards unsaved changes', () => {
    expect(adminPageHtml).toContain('id="playbook-editor" class="form-section" disabled');
    expect(adminPageHtml).toContain('Ungespeicherte Dashboard-Analysen verwerfen?');
    expect(adminPageHtml).not.toContain('id="playbook-load"');
    expect(adminPageHtml).not.toContain('id="playbook-list"');
  });

  it('uses a masked password dialog and a native user creation form', () => {
    expect(adminPageHtml).toContain('<dialog id="user-password-dialog" aria-labelledby="user-password-title">');
    expect(adminPageHtml).toContain('type="password" id="user-password-value"');
    expect(adminPageHtml).toContain('<form id="create-user-form">');
    expect(adminPageHtml).not.toContain('window.prompt(');
  });

  it('labels account and extension inputs and groups settings in responsive forms', () => {
    for (const id of ['new-username', 'new-display-name', 'new-password', 'trex-url']) {
      expect(adminPageHtml).toContain(`for="${id}"`);
    }
    expect(adminPageHtml).toContain('<fieldset class="form-section"><legend>Enterprise-Lizenz</legend>');
    expect(adminPageHtml).toContain('class="form-grid"');
    expect(adminPageHtml).toContain('type="url" id="trex-url"');
  });

  it('offers labeled first-run and login forms with matching password limits', () => {
    expect(adminPageHtml).toContain('<form id="gate-setup" hidden>');
    expect(adminPageHtml).toContain('<form id="gate-login" hidden>');
    for (const id of ['setup-password', 'setup-confirm', 'login-password']) {
      expect(adminPageHtml).toContain(`for="${id}"`);
      expect(adminPageHtml).toMatch(new RegExp(`id="${id}"[^>]*required[^>]*maxlength="200"`));
    }
    expect(adminPageHtml).toContain('id="gate-error" class="banner error" role="alert"');
  });

  it('uses the documented product logo in the admin header', () => {
    const source = adminPageHtml.match(/<div class="brand"><img src="data:image\/svg\+xml,([^"]+)"/);
    expect(source).not.toBeNull();
    const logo = readFileSync(new URL('../../../docs/images/logo.svg', import.meta.url), 'utf8');
    expect(decodeURIComponent(source![1]!)).toBe(logo.trim());
  });

  it('keeps every navigation destination unique and available in the mobile selector', () => {
    // Nur die Navigation zählt — Hilfetexte im Inhalt dürfen zusätzlich auf
    // Abschnitte verweisen (z. B. „SSO im Abschnitt Anmeldung einrichten“).
    const nav = adminPageHtml.match(/<nav aria-label="Administration">[\s\S]*?<\/nav>/)?.[0] ?? '';
    const targets = [...nav.matchAll(/href="#([a-z-]+)"/g)].map(match => match[1]);
    expect(targets).toHaveLength(9);
    expect(new Set(targets).size).toBe(9);
    for (const target of targets) {
      expect(adminPageHtml.split(`id="${target}"`)).toHaveLength(2);
      expect(adminPageHtml).toContain(`value="${target}"`);
    }
    expect(adminPageHtml).toContain('aria-label="Administration"');
    expect(adminPageHtml).toContain('aria-label="Administrationsbereich"');
  });

  it('allows the embedded font only on admin, without opening external font origins', async () => {
    const instance = createApp({ ...loadEnv({ LITELLM_BASE_URL: 'http://localhost:9', LITELLM_API_KEY: 'test', DEFAULT_MODEL: 'test', ADMIN_TOKEN: 'test-admin', MEMORY_ENABLED: 'false' }), telemetryEndpoint: '' });
    try {
      const response = await instance.app.request('/admin');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain("font-src 'self' data:");
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(adminPageHtml).toContain('data:font/woff2;base64,');
      const callback = await instance.app.request('/auth/callback');
      expect(callback.headers.get('content-security-policy')).not.toContain('font-src');
    } finally {
      instance.stopHeartbeat();
      await instance.memoryStore?.close();
    }
  });
});

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

  it('renders separate local and SSO access controls with explicit grants', () => {
    expect(adminPageHtml).toContain('id="user-access-table"');
    expect(adminPageHtml).toContain('id="user-access-refresh"');
    expect(adminPageHtml).toContain("adminFetch('/user-access')");
    expect(adminPageHtml).toContain("adminFetch('/user-access/' + encodeURIComponent(u.id)");
    expect(adminPageHtml).toContain("{ ai: aiInput.checked, tableauApi: tableauInput.checked }");
    expect(adminPageHtml).toContain("'SSO · ' + (u.issuer || 'Issuer unbekannt') + ' · subject: '");
    expect(adminPageHtml).toContain("'Lokal · ' + (u.subject || u.id)");
    expect(adminPageHtml).toContain("status.textContent = aiInput.checked || tableauInput.checked ? 'freigegeben' : 'ausstehend'");
    expect(adminPageHtml).toContain('name.textContent = u.displayName || u.email || u.subject || u.id;');
    expect(adminPageHtml).toContain('email.textContent = u.email || \'—\';');
    expect(adminPageHtml).toContain('return loadUsers().then(loadUserAccess)');
  });
});

/**
 * Feld-Erklärungen leben in einem Hover/Fokus-Tooltip statt in Absätzen
 * (siehe Betreiber-Vorgabe: „Tausche das Fragezeichen durch ein Hover" —
 * kein sichtbares ?-Symbol mehr, Erklärung beim Überfahren des Labels bzw.
 * bei Tastaturfokus auf das zugehörige Eingabefeld). Diese Tests halten das
 * durch.
 */
describe('help tooltips', () => {
  it('has no more .help-icon buttons and anchors every tooltip in a .has-help label/header/legend', () => {
    expect(adminPageHtml).not.toContain('help-icon');
    const tooltips = [...adminPageHtml.matchAll(/<span[^>]*\brole="tooltip"[^>]*\bid="([^"]+)"[^>]*>/g)];
    expect(tooltips.length).toBeGreaterThan(0);
    // Auslöser ist nur der unterstrichene Begriff (.help-term), nicht das Feld — sonst
    // ploppt beim Überfahren des Formulars an jedem Eingabefeld ein Tooltip auf.
    const anchored = adminPageHtml.match(/<\w+[^>]*\bclass="[^"]*\bhas-help\b[^"]*"[^>]*><span class="help-term">[^<]+<\/span><span[^>]*\brole="tooltip"/g) ?? [];
    expect(anchored.length, 'every role="tooltip" must follow a .help-term inside a .has-help element').toBe(tooltips.length);
  });

  it('keeps every <p class="hint"> short — long explanations belong in a ?-icon', () => {
    const paragraphs = [...adminPageHtml.matchAll(/<p\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g)]
      .filter(([, classes]) => (classes ?? '').split(/\s+/).includes('hint'));
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const [, , inner] of paragraphs) {
      const text = (inner ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      expect(text.length, text).toBeLessThanOrEqual(200);
    }
  });

  it('no longer ships the removed first-run checklist', () => {
    expect(adminPageHtml).not.toContain('Ersteinrichtung in dieser Reihenfolge');
    expect(adminPageHtml).not.toContain('id="setup-checklist"');
  });
});
