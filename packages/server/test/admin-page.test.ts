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
    expect(adminPageHtml).toContain('<fieldset class="form-section"><legend>Lizenzschlüssel eintragen oder ersetzen</legend>');
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

  it('groups the navigation by setup order and lands on the overview', () => {
    const nav = adminPageHtml.match(/<nav aria-label="Administration">[\s\S]*?<\/nav>/)?.[0] ?? '';
    const groups = [...nav.matchAll(/<p class="nav-group">([^<]+)<\/p>/g)].map(match => match[1]);
    expect(groups).toEqual(['Einrichtung', 'Zugriff', 'Inhalte', 'Betrieb']);
    const targets = [...nav.matchAll(/href="#([a-z-]+)"/g)].map(match => match[1]);
    expect(targets.slice(0, 5)).toEqual(['overview-admin', 'license-admin', 'auth-admin', 'tableau-server-admin', 'models-admin']);
    // Erste Option = Standardansicht nach dem Login.
    expect(adminPageHtml).toMatch(/<select id="admin-navigation"[^>]*>\s*<optgroup label="Einrichtung"><option value="overview-admin">/);
    // Tableau-Sites und MCP-Bereiche heißen verschieden — kein zweites „Sites“ mehr in der Navigation.
    expect(nav).toContain('MCP-Quellen');
    expect(nav).not.toContain('MCP &amp; Sites');
    expect(nav).toContain('Benutzer &amp; Zugriff');
  });

  it('shows the Enterprise badge on the page title instead of a second heading in EE sections', () => {
    for (const target of ['mcp-admin', 'watch-admin', 'tableau-audit-admin']) {
      expect(adminPageHtml).toContain(`<option value="${target}" data-ee="true">`);
    }
    // Tableau Server: Navigation bleibt kurz, der Seitentitel nennt die REST-API-Verbindung (englisch).
    expect(adminPageHtml).toContain('<option value="tableau-server-admin" data-ee="true" data-title="Tableau Server REST API Connection">Tableau Server</option>');
    expect(adminPageHtml).toContain("document.getElementById('view-title-text').textContent = option.dataset.title || option.textContent;");
    expect(adminPageHtml).toContain('<span id="view-badge" class="view-badge" hidden>Enterprise</span>');
    expect(adminPageHtml).toContain("document.getElementById('view-badge').hidden = option.dataset.ee !== 'true';");
    // Kein Abschnitt wiederholt den Seitentitel sichtbar: die erste h2 je Abschnitt ist nur für Screenreader.
    for (const id of ['overview', 'license', 'auth', 'users', 'commands', 'playbooks', 'metrics', 'models', 'extension', 'usage']) {
      expect(adminPageHtml, id).toContain(`<h2 id="${id}-heading" class="visually-hidden">`);
    }
  });

  it('summarises the setup state on the overview with worded status chips and links', () => {
    for (const [key, href] of [['license', 'license-admin'], ['publicUrl', 'auth-admin'], ['auth', 'auth-admin'], ['access', 'users-admin'], ['tableau', 'tableau-server-admin'], ['models', 'models-admin'], ['llm', 'models-admin']]) {
      expect(adminPageHtml).toMatch(new RegExp(`<li class="status-row" data-key="${key}">[^]*?<a class="status-link" href="#${href}">`));
    }
    expect(adminPageHtml).toContain("var overviewLabels = { ok: 'Bereit', warn: 'Unvollständig', error: 'Fehler', off: 'Nicht aktiv' };");
    expect(adminPageHtml).toContain('function overviewSet(key, level, text)');
    // Zustand nie nur über Farbe: jede Stufe hat ein Symbol und ein Wort.
    expect(adminPageHtml).toContain('.status-chip[data-level="error"]::before { content: \'✕\'; }');
    expect(adminPageHtml).toContain("pending + ' Personen warten auf Freigabe.'");
  });

  it('shows LLM figures first on the overview and version plus a click-only update check as tiles on the licence page', () => {
    for (const id of ['kpi-questions', 'kpi-calls', 'kpi-tokens-in', 'kpi-tokens-out', 'kpi-latency', 'kpi-errors', 'sys-version', 'sys-edition', 'update-check', 'update-result']) {
      expect(adminPageHtml, id).toContain(`id="${id}"`);
    }
    // LLM-Kennzahlen stehen vor dem Stand der Einrichtung; Version & Updates liegen als Kacheln unter „Lizenz & Aktivierung“.
    expect(adminPageHtml).toMatch(/id="overview-admin"[\s\S]*?LLM-Betrieb \(letzte 7 Tage\)[\s\S]*?Stand der Einrichtung[\s\S]*?id="overview-list"/);
    expect(adminPageHtml).toMatch(/<ul class="status-list" id="license-tiles">[\s\S]*?id="sys-version"[\s\S]*?id="update-check"[\s\S]*?<\/ul>/);
    expect(adminPageHtml).not.toContain('id="update-howto"');
    expect(adminPageHtml).toContain('<li class="status-row" data-key="llm">');
    expect(adminPageHtml).toContain("adminFetch('/stats?days=7')");
    expect(adminPageHtml).toContain("adminFetch('/upstream-models')");
    expect(adminPageHtml).toContain("adminFetch('/system')");
    // Die Update-Prüfung läuft nur auf Klick — beim Laden der Seite nie.
    const loadAll = adminPageHtml.match(/function loadAll\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(loadAll).not.toContain('update-check');
    expect(adminPageHtml).toMatch(/getElementById\('update-check'\)\.addEventListener\('click'[\s\S]*?adminFetch\('\/update-check'\)/);
    // Nutzung zeigt sprechende Namen statt Metrik-IDs.
    expect(adminPageHtml).toContain("h3.textContent = metricLabels[metric] || metric;");
  });

  it('saves the licence separately from the sign-in settings', () => {
    expect(adminPageHtml).toContain('<button class="primary" id="save-license">Lizenz prüfen &amp; speichern</button>');
    // Anmeldung: Kacheln auf der Seite, je Einstellung ein eigener Formular-Dialog.
    for (const id of ['auth-mode-dialog', 'auth-url-dialog', 'oidc-dialog']) expect(adminPageHtml).toContain(`<dialog id="${id}"`);
    for (const id of ['auth-mode-edit', 'auth-url-edit', 'oidc-edit']) expect(adminPageHtml).toContain(`id="${id}"`);
    expect(adminPageHtml).not.toContain('id="save-auth"');
    const saveAuth = adminPageHtml.match(/function saveAuth\(dialog\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(saveAuth).toContain('putAuthSettings(body, dialogBanner(dialog)');
    expect(saveAuth).not.toContain('license');
    // Die Lizenz-Karte speichert mit dem bereits gültigen Modus, nie mit dem Formularstand unter „Anmeldung“.
    expect(adminPageHtml).toContain('return putAuthSettings({ mode: mode, license: license }, licenseBanner, okText, loadInstallations);');
    expect(adminPageHtml).toContain('if (lastAuthData.stored && lastAuthData.stored.mode) return lastAuthData.stored.mode;');
    expect(adminPageHtml).toContain('bitte auch die Lizenz per Env setzen (OVP_LICENSE)');
    // Zurücksetzen löscht auch den gespeicherten Lizenzschlüssel — das steht im Dialog und daneben.
    expect(adminPageHtml).toMatch(/window\.confirm\('Alle Anmelde- und Lizenzeinstellungen der Admin-UI verwerfen \(auch den hier gespeicherten Lizenzschlüssel\)/);
    expect(adminPageHtml).toMatch(/<div class="danger-zone">[\s\S]*?id="reset-auth"/);
  });

  it('walks through single sign-on in numbered steps with visible prerequisites', () => {
    expect(adminPageHtml).toMatch(/<ol class="setup-flow">[\s\S]*?Redirect-URI beim Identity-Provider registrieren[\s\S]*?Werte vom Identity-Provider eintragen[\s\S]*?Speichern und Personen freischalten/);
    expect(adminPageHtml).toContain('<p id="oidc-license-hint" class="banner error" role="status" hidden>Single Sign-On braucht eine gültige Enterprise-Lizenz mit „sso“. <a href="#license-admin">Zur Lizenz</a></p>');
    expect(adminPageHtml).toContain("document.getElementById('oidc-license-hint').hidden = authMode.value !== 'oidc' || hasSso;");
    // „Offen“ erklärt sich sichtbar, nicht nur im Tooltip.
    expect(adminPageHtml).toContain('<p id="auth-mode-none-hint" class="hint error" hidden>Ohne Anmeldung gibt es keine Anwenderidentität');
    expect(adminPageHtml).toContain("document.getElementById('oidc-setup').open = !oidc;");
  });

  it('tells Entra admins to use the Web platform with a client secret, because the middleware redeems the code', () => {
    const entra = adminPageHtml.match(/<ol id="oidc-setup-entra">[\s\S]*?<\/ol>/)?.[0] ?? '';
    expect(entra).toContain('<strong>Web</strong>');
    expect(entra).toContain('AADSTS9002327');
    expect(entra).toContain('„Neuer geheimer Clientschlüssel“');
    expect(entra).not.toContain('Kein Client-Secret anlegen');
    expect(adminPageHtml).toContain('<p id="oidc-entra-secret-hint" class="hint error" style="grid-column: 1 / -1; margin: 0;" hidden>Entra ID braucht ein Client-Secret');
    expect(adminPageHtml).toContain("document.getElementById('oidc-entra-secret-hint').hidden = !entra || stored || fromEnv || Boolean(oidcClientSecret.value);");
    expect(adminPageHtml).toContain("fromEnv ? 'aus OVP_OIDC_CLIENT_SECRET (Env)'");
  });

  it('opens the admin SSO popup synchronously on the click and navigates it after the PKCE hash', () => {
    const handler = adminPageHtml.match(/getElementById\('sso-submit'\)\.addEventListener\('click'[\s\S]*?\n  \}\);/)?.[0] ?? '';
    const openAt = handler.indexOf("window.open('about:blank', 'openvizpilot-admin-login'");
    expect(openAt).toBeGreaterThan(-1);
    expect(openAt).toBeLessThan(handler.indexOf("crypto.subtle.digest('SHA-256'"));
    expect(handler).toContain('popup.location.href = url.toString();');
    expect(handler).toContain('if (!popup.closed) popup.close();');
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
    expect(targets).toHaveLength(14);
    expect(new Set(targets).size).toBe(14);
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
    // Kein Aktualisieren-Button: der Bereichswechsel lädt die Daten neu.
    expect(adminPageHtml).not.toContain('id="user-access-refresh"');
    expect(adminPageHtml).toContain("'users-admin': function () { loadUsers(); loadUserAccess(); },");
    expect(adminPageHtml).toContain("adminFetch('/user-access')");
    expect(adminPageHtml).toContain("adminFetch('/user-access/' + encodeURIComponent(u.id)");
    expect(adminPageHtml).toContain("{ ai: aiInput.checked, tableauApi: tableauInput.checked, serverData: serverDataInput.checked, admin: adminInput.checked }");
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

  it('adds a Serverdaten switch column (W5) enabled for every admin, unlike the Admin role switch', () => {
    expect(adminPageHtml).toContain('<span class="help-term">Serverdaten</span><span role="tooltip" id="help-access-serverdata" class="help-tip">Erlaubt der Middleware, im Namen dieser Person Summary-Daten von Tableau-Views zu lesen — nur mit Site-Schalter und Einwilligung der Person; jede Abfrage steht im Audit unter Tableau Server.</span>');
    expect(adminPageHtml).toContain("serverDataInput.setAttribute('role', 'switch');");
    expect(adminPageHtml).toContain("serverDataInput.checked = u.serverData === true;");
    // Anders als der Admin-Schalter bleibt Serverdaten für jeden Admin bedienbar.
    expect(adminPageHtml).not.toContain('serverDataInput.disabled = !canGrantAdmin');
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
