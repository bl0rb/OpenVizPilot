import { describe, expect, it } from 'vitest';
import { tableauAdminScript, tableauAdminSection, tableauAdminStyles } from '../server/src/tableau-server/admin-ui';

describe('Tableau admin UI: global fields and sites list', () => {
  it('keeps the global fields (enabled, server URL, username claim, min version) at the top', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-enabled"');
    expect(tableauAdminSection).toContain('id="tableau-server-url"');
    expect(tableauAdminSection).toContain('id="tableau-server-username-claim"');
    expect(tableauAdminSection).toContain('Tableau-Mindestversion');
    // Site-specific fields no longer live at the top level.
    expect(tableauAdminSection).not.toContain('id="tableau-server-client-id"');
    expect(tableauAdminSection).not.toContain('id="tableau-server-secret-id"');
    expect(tableauAdminSection).not.toContain('id="tableau-server-site-id"');
  });

  it('renders a Sites list container and an add-site button, following the MCP sites/servers list pattern', () => {
    expect(tableauAdminSection).toContain('<h3>Sites</h3>');
    expect(tableauAdminSection).toContain('id="tableau-server-sites"');
    expect(tableauAdminSection).toContain('id="tableau-server-add-site"');
    expect(tableauAdminSection).toContain('+ Site hinzufügen');
    expect(tableauAdminScript).toContain("function renderTableauSiteCard(site)");
    expect(tableauAdminScript).toContain('function renderTableauSites()');
    expect(tableauAdminScript).toContain("document.getElementById('tableau-server-add-site').addEventListener('click'");
  });

  it('builds each site card with name, content-url, auth-mode, client-id/secret-id or site-id fields', () => {
    expect(tableauAdminScript).toContain("field('Name *', site.name");
    expect(tableauAdminScript).toContain("field('Content-URL (leer = Standard-Site)', site.contentUrl");
    expect(tableauAdminScript).toContain("'connected-app', 'Connected App – Direct Trust (Client-ID, Secret)'");
    expect(tableauAdminScript).toContain("'oauth2-trust', 'Connected App – OAuth 2.0 Trust (Site-ID)'");
    expect(tableauAdminScript).toContain("'label', 'Client-ID', connectedAppFields");
    expect(tableauAdminScript).toContain("'label', 'Secret-ID', connectedAppFields");
    expect(tableauAdminScript).toContain("'label', 'Site-ID (Site-LUID aus Tableau)', oauth2Fields");
  });

  it('offers per-site actions: Konfiguration prüfen, Verbindung als Nutzer prüfen, Site entfernen', () => {
    expect(tableauAdminScript).toContain("'Konfiguration prüfen', actions");
    expect(tableauAdminScript).toContain("'Verbindung als Nutzer prüfen', actions");
    expect(tableauAdminScript).toContain("'Site entfernen', actions");
    expect(tableauAdminScript).toContain("adminFetch('/tableau-server/check', jsonRequest('POST', { siteId: site.id }))");
    expect(tableauAdminScript).toContain('tableauServerRunConnectionTest(site.id, testButton, resultEl)');
  });

  it('caps sites at 50, mirroring the max in the schema', () => {
    expect(tableauAdminScript).toContain('tableauServerSites.length >= 50');
    expect(tableauAdminScript).toContain('Maximal 50 Sites.');
  });
});

describe('Tableau admin UI: secret handling (Teil B)', () => {
  it('shows a write-only secret with DB/env/unset status text and Ersetzen/Entfernen actions', () => {
    expect(tableauAdminScript).toContain('function tableauServerSecretStatusText(site)');
    expect(tableauAdminScript).toContain("'gespeichert (im Web, verschlüsselt)'");
    expect(tableauAdminScript).toContain("'aus Umgebungsvariable '");
    expect(tableauAdminScript).toContain("return 'nicht gesetzt';");
    expect(tableauAdminScript).toContain("'Ersetzen', secretRow");
    expect(tableauAdminScript).toContain('secretInput.type = \'password\'');
    expect(tableauAdminScript).not.toContain('secretInput.value = site.secretConfigured');
  });

  it('disables secret editing and explains why when OVP_SECRET_KEY is not configured', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-secretkey-status"');
    expect(tableauAdminScript).toContain('OVP_SECRET_KEY setzen, um Secrets zu speichern.');
    expect(tableauAdminScript).toContain('!tableauServerState.secretKeyConfigured');
  });

  it('never sends the stored secret back to the field — only a freshly typed replacement or a clear flag', () => {
    expect(tableauAdminScript).toContain("if (site.secretAction === 'clear') payload.secretClear = true;");
    expect(tableauAdminScript).toContain("else if (site.secretAction === 'replace' && site.secretValue) payload.secret = site.secretValue;");
  });

  it('never logs or embeds a private key material anywhere in the generated page', () => {
    expect(tableauAdminScript).not.toMatch(/privateKey/i);
    expect(tableauAdminSection).not.toMatch(/privateKey/i);
    expect(tableauAdminScript).not.toContain('.innerHTML');
  });
});

describe('Tableau admin UI: dashboard-to-site mapping', () => {
  it('renders a Dashboard→Site mapping table with an add button', () => {
    expect(tableauAdminSection).toContain('<h3>Dashboard-Zuordnung</h3>');
    expect(tableauAdminSection).toContain('id="tableau-server-mapping-table"');
    expect(tableauAdminSection).toContain('id="tableau-server-mapping-rows"');
    expect(tableauAdminSection).toContain('id="tableau-server-add-mapping"');
    expect(tableauAdminScript).toContain('function renderTableauMapping()');
  });

  it('hints that mapping is unnecessary with only one site', () => {
    expect(tableauAdminScript).toContain('Mit nur einer Site ist keine Zuordnung nötig.');
    expect(tableauAdminScript).toContain('var onlyOneSite = tableauServerSites.length <= 1;');
  });

  it('reuses the existing registered-dashboards endpoint instead of adding a new route', () => {
    expect(tableauAdminScript).toContain("adminFetch('/playbooks')");
    expect(tableauAdminScript).not.toContain("adminFetch('/tableau-server/dashboards'");
  });

  it('builds the PUT payload dashboardSites map only from complete rows', () => {
    expect(tableauAdminScript).toContain('if (mapping.dashboardKey && mapping.siteId) dashboardSites[mapping.dashboardKey] = mapping.siteId;');
  });
});

describe('Tableau admin OAuth 2.0 Trust (EAS): stays global across sites', () => {
  it('shows one shared Issuer URL/JWKS/Key-ID block, not per site', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-eas-block"');
    expect(tableauAdminSection).toContain('gilt für alle Sites');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-issuer" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-jwks" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-kid" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-issuer-copy" type="button" disabled');
  });

  it('warns about a missing HTTPS public URL and links to the login/SSO/license section', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-eas-warning"');
    expect(tableauAdminSection).toMatch(/id="tableau-server-eas-warning"[^>]*hidden/);
    expect(tableauAdminSection).toContain('href="#auth-admin"');
  });

  it('renders the eas display fields from state and copes with eas === null', () => {
    expect(tableauAdminScript).toContain('function tableauServerRenderEas()');
    expect(tableauAdminScript).toContain('var eas = tableauServerState.eas;');
    expect(tableauAdminScript).toContain('eas ? eas.issuerUrl : pending');
    expect(tableauAdminScript).toContain("document.getElementById('tableau-server-eas-issuer-copy').disabled = !eas");
    expect(tableauAdminScript).toContain('eas: null');
  });

  it('adapts the step-by-step setup blocks to "one Connected App per site"', () => {
    expect(tableauAdminSection).toContain('<details id="tableau-server-setup-connected-app">');
    expect(tableauAdminSection).toContain('<details id="tableau-server-setup-oauth2-trust">');
    expect(tableauAdminSection).toContain('Je Site eine Connected App in Tableau');
    expect(tableauAdminSection).toContain('Je Site in Tableau: <em>Settings → Connected Apps → New Connected App → OAuth 2.0 Trust</em>');
    expect((tableauAdminSection.match(/Lizenz mit den Merkmalen <code>sso<\/code> und <code>tableauServer<\/code>/g) || []).length).toBe(2);
  });
});

describe('Tableau admin UI: personal connection test stays per site', () => {
  it('keeps the browser-side PKCE popup and strict callback checks', () => {
    expect(tableauAdminScript).toContain("window.open('about:blank', 'openvizpilot-tableau-login'");
    expect(tableauAdminScript).toContain("crypto.subtle.digest('SHA-256'");
    expect(tableauAdminScript).toContain("url.searchParams.set('code_challenge_method', 'S256')");
    expect(tableauAdminScript).toContain('var expectedOrigin = window.location.origin');
    expect(tableauAdminScript).toContain('event.origin !== expectedOrigin || event.source !== popup');
    expect(tableauAdminScript).toContain("data.type !== 'openvizpilot-oidc' || data.state !== state");
    expect(tableauAdminScript).toContain("fetch('/api/auth/config'");
    expect(tableauAdminScript).toContain("fetch('/api/auth/exchange'");
    expect(tableauAdminScript).toContain("fetch('/api/tableau-server/check'");
    expect(tableauAdminScript).toContain("authorization: 'Bearer ' + idToken");
  });

  it('sends the target siteId with the personal connection test, not a dashboardKey', () => {
    expect(tableauAdminScript).toContain('body: JSON.stringify({ siteId: siteId })');
  });

  it('parses as inline JavaScript', () => {
    expect(() => new Function(tableauAdminScript)).not.toThrow();
  });
});
