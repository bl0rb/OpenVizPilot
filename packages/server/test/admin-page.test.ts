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

  it('shows the licence card with activation state, refresh and offline activation', () => {
    expect(adminPageHtml).toContain('<div id="license-card" hidden>');
    // Ausstehende Aktivierung: deutlicher Hinweis mit beiden Wegen (online / Offline-Lease).
    expect(adminPageHtml).toMatch(/<p id="license-pending" class="banner" role="alert">[^]*?noch nicht aktiviert[^]*?werkworks\.de[^]*?Offline-Aktivierung[^]*?<\/p>/);
    expect(adminPageHtml).toContain("'banner' + (lic.leaseState === 'pending' ? ' error' : '')");
    expect(adminPageHtml).toContain("lic.leaseOffline ? 'Offline-Lease bis ' : 'Aktiv bis '");
    for (const id of ['lic-licensee', 'lic-id', 'lic-env', 'lic-inst', 'lic-inst-full', 'lic-lease', 'lic-valid', 'lic-features']) {
      expect(adminPageHtml).toContain(`id="${id}"`);
    }
    // Tooltips im bestehenden Muster: Umgebung, Installation-ID (gekürzt, voll im Tooltip), Aktivierung, Lease-Feld.
    for (const id of ['help-lic-env', 'help-lic-inst', 'help-lic-lease', 'help-lic-lease-paste']) {
      expect(adminPageHtml).toMatch(new RegExp(`<span role="tooltip" id="${id}" class="help-tip">`));
    }
    expect(adminPageHtml).toContain('<button id="license-refresh">Jetzt aktualisieren</button>');
    expect(adminPageHtml).toContain('<details class="setup-steps" id="offline-activation"');
    expect(adminPageHtml).toContain('id="activation-request-download"');
    expect(adminPageHtml).toContain('<textarea id="license-lease"');
    expect(adminPageHtml).toContain('id="license-lease-save"');
    expect(adminPageHtml).toContain("adminFetch('/license/refresh', { method: 'POST' })");
    expect(adminPageHtml).toContain("adminFetch('/license/activation-request')");
    expect(adminPageHtml).toContain("adminFetch('/license/lease', jsonRequest('PUT'");
    expect(adminPageHtml).toContain('<code>OVP_ENVIRONMENT</code> (nur per Env)');
  });

  it('warns during the 7-day subscription grace period after licence expiry, separate from the lease grace banner', () => {
    expect(adminPageHtml).toContain('<p id="license-subscription-grace" class="banner error" role="status" hidden></p>');
    expect(adminPageHtml).toContain('graceBanner.hidden = !lic.subscriptionGraceUntil;');
    expect(adminPageHtml).toContain(
      "'Lizenz am ' + fmtDate(lic.validUntil) + ' abgelaufen — Enterprise-Funktionen laufen noch bis ' + fmtDate(lic.subscriptionGraceUntil) + '. Bitte Lizenz verlängern.'",
    );
  });

  it('offers deactivate/transfer for the installations of this licence and links the offline self-service page', () => {
    expect(adminPageHtml).toContain('<button id="license-deactivate">Diese Installation stilllegen</button>');
    expect(adminPageHtml).toContain('id="license-installations-body"');
    expect(adminPageHtml).toContain('id="license-installations-hint"');
    expect(adminPageHtml).toContain("adminFetch('/license/installations')");
    expect(adminPageHtml).toContain("adminFetch('/license/deactivate', jsonRequest('POST', { confirm: true }))");
    expect(adminPageHtml).toContain("adminFetch('/license/transfer', jsonRequest('POST', { installationId: full }))");
    // Bestätigungsdialoge vor beiden zerstörerischen Aktionen.
    expect(adminPageHtml).toMatch(/window\.confirm\('Diese Installation stilllegen\?/);
    expect(adminPageHtml).toMatch(/window\.confirm\('Die Installation ' \+ short \+ ' verliert ihre Enterprise-Funktionen beim nächsten Heartbeat\. Fortfahren\?'\)/);
    // Nur der initiale Admin darf stilllegen/übertragen — die UI spiegelt das serverseitige `initial_admin_required`.
    expect(adminPageHtml).toMatch(/adminMe && adminMe\.role === 'initial'/);
    // Offline-Aktivierung: Link auf die neue Selbstbedienungsseite von werkworks.de.
    expect(adminPageHtml).toContain('href="https://werkworks.de/ovp-lizenz/offline.php"');
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

  it('offers a user-account login (local form or SSO popup) next to token/password', () => {
    expect(adminPageHtml).toContain('<div id="gate-user" hidden>');
    expect(adminPageHtml).toContain('<form id="gate-user-login" hidden>');
    for (const id of ['user-login-name', 'user-login-password']) {
      expect(adminPageHtml).toContain(`for="${id}"`);
      expect(adminPageHtml).toMatch(new RegExp(`id="${id}"[^>]*required`));
    }
    expect(adminPageHtml).toContain('<button class="primary" id="sso-submit" type="button">Mit Single Sign-On anmelden</button>');
    expect(adminPageHtml).toContain("fetch('/api/auth/config')");
    expect(adminPageHtml).toContain("fetch('/api/auth/login'");
    expect(adminPageHtml).toContain("fetch('/api/auth/exchange'");
    expect(adminPageHtml).toContain("crypto.subtle.digest('SHA-256'");
    expect(adminPageHtml).toContain("url.searchParams.set('code_challenge_method', 'S256');");
    expect(adminPageHtml).toContain("data.type !== 'openvizpilot-oidc'");
    expect(adminPageHtml).toContain("fetch('/api/admin/me', { headers: { authorization: 'Bearer ' + token } })");
    expect(adminPageHtml).toContain("'Dieses Konto hat keine Admin-Rolle.'");
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
    expect(targets).toHaveLength(10);
    expect(new Set(targets).size).toBe(10);
    for (const target of targets) {
      expect(adminPageHtml.split(`id="${target}"`)).toHaveLength(2);
      expect(adminPageHtml).toContain(`value="${target}"`);
    }
    expect(adminPageHtml).toContain('aria-label="Administration"');
    expect(adminPageHtml).toContain('aria-label="Administrationsbereich"');
  });

  it('allows the embedded font only on admin, without opening external font origins', async () => {
    const instance = createApp({ ...loadEnv({ OVP_LLM_BASE_URL: 'http://localhost:9', OVP_LLM_API_KEY: 'test', OVP_DEFAULT_MODEL: 'test', OVP_ADMIN_TOKEN: 'test-admin', MEMORY_ENABLED: 'false' }), telemetryEndpoint: '' });
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
    expect(adminPageHtml).toContain("{ ai: aiInput.checked, tableauApi: tableauInput.checked, admin: adminInput.checked }");
    expect(adminPageHtml).toContain("'SSO · ' + (u.issuer || 'Issuer unbekannt') + ' · subject: '");
    expect(adminPageHtml).toContain("'Lokal · ' + (u.subject || u.id)");
    expect(adminPageHtml).toContain("status.textContent = aiInput.checked || tableauInput.checked ? 'freigegeben' : 'ausstehend'");
    expect(adminPageHtml).toContain('name.textContent = u.displayName || u.email || u.subject || u.id;');
    expect(adminPageHtml).toContain('email.textContent = u.email || \'—\';');
    expect(adminPageHtml).toContain('return loadUsers().then(loadUserAccess)');
  });

  it('shows the admin role switch read-only for delegated admins and announces the signed-in admin', () => {
    expect(adminPageHtml).toContain('<span class="help-term">Admin</span><span role="tooltip" id="help-access-admin" class="help-tip">Darf die Administration bedienen; Admin-Rolle vergeben kann nur der initiale Admin (Token bzw. Admin-Konto).</span>');
    expect(adminPageHtml).toContain("var canGrantAdmin = Boolean(adminMe && adminMe.role === 'initial');");
    expect(adminPageHtml).toContain('adminInput.disabled = !canGrantAdmin;');
    expect(adminPageHtml).toContain("adminFetch('/me')");
    expect(adminPageHtml).toContain('<span id="admin-identity" hidden></span>');
    expect(adminPageHtml).toContain("'Angemeldet als ' + me.name");
    expect(adminPageHtml).toContain("data.code === 'not_admin'");
    expect(adminPageHtml).toContain("showGate('Dieses Konto hat keine Admin-Rolle.')");
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
