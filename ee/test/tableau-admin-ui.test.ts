import { describe, expect, it } from 'vitest';
import { tableauAdminScript, tableauAdminSection, tableauAdminStyles } from '../server/src/tableau-server/admin-ui';

describe('Tableau admin personal connection test UI', () => {
  it('exposes a gated personal test without a manual token field', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-connection-test" type="button" disabled');
    expect(tableauAdminSection).toContain('Verbindung als Nutzer prüfen');
    expect(tableauAdminSection).not.toMatch(/id="[^"]*(token|bearer)[^"]*"/i);
    expect(tableauAdminScript).toContain("!config.enabled || !tableauServerState.licensed || !tableauServerState.oidcReady");
    expect(tableauAdminScript).toContain('tableauServerDirty');
  });

  it('contains the browser-side PKCE popup and strict callback checks', () => {
    expect(tableauAdminScript).toContain("window.open('about:blank', 'openvizpilot-tableau-login'");
    expect(tableauAdminScript).toContain("crypto.subtle.digest('SHA-256'");
    expect(tableauAdminScript).toContain("url.searchParams.set('code_challenge_method', 'S256')");
    expect(tableauAdminScript).toContain("var expectedOrigin = window.location.origin");
    expect(tableauAdminScript).toContain("event.origin !== expectedOrigin || event.source !== popup");
    expect(tableauAdminScript).toContain("data.type !== 'openvizpilot-oidc' || data.state !== state");
    expect(tableauAdminScript).toContain("fetch('/api/auth/config'");
    expect(tableauAdminScript).toContain("fetch('/api/auth/exchange'");
    expect(tableauAdminScript).toContain("fetch('/api/tableau-server/check'");
    expect(tableauAdminScript).toContain("authorization: 'Bearer ' + idToken");
    expect(tableauAdminScript).toContain('clearInterval(closedPoll)');
    expect(tableauAdminScript).toContain('clearTimeout(flowTimeout)');
    expect(tableauAdminScript).toContain("cleanup('aborted')");
    expect(tableauAdminScript).toContain('controller.abort()');
    expect(tableauAdminScript).toContain("flowTimedOut = true");
    expect(tableauAdminScript).toContain("result.textContent = ''");
    expect(tableauAdminScript).not.toContain("result.innerHTML");
  });

  it('keeps the existing configuration check separate from the live connection test', () => {
    expect(tableauAdminScript).toContain("adminFetch('/tableau-server/check', { method: 'POST' })");
    expect(tableauAdminScript).toContain("data.stage === 'configuration'");
    expect(tableauAdminScript).toContain("data.stage === 'connection'");
    expect(tableauAdminScript).toContain("data.ok === true && data.stage === 'connection'");
    expect(tableauAdminScript).toContain("checks.length > 0 && checks.every");
    expect(tableauAdminScript).toContain("document.getElementById('tableau-server-connection-test').disabled = true");
    expect(tableauAdminStyles).toContain('tableau-server-connection-result');
  });

  it('parses as inline JavaScript', () => {
    expect(() => new Function(tableauAdminScript)).not.toThrow();
  });
});

describe('Tableau admin OAuth 2.0 Trust (EAS) UI', () => {
  it('offers a mode select with the two Tableau-labeled Connected App options', () => {
    expect(tableauAdminSection).toContain('<select id="tableau-server-auth-mode">');
    expect(tableauAdminSection).toContain('Connected App – Direct Trust (Client-ID, Secret)');
    expect(tableauAdminSection).toContain('Connected App – OAuth 2.0 Trust (Issuer-URL, JWKS)');
    expect(tableauAdminSection).not.toContain('Connected App (JWT)');
  });

  it('shows Tableau-labeled Direct Trust fields with their help text', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-connected-app-fields"');
    expect(tableauAdminSection).toContain('HTTPS-Origin ohne Pfad, z. B. https://tableau.example.com');
    expect(tableauAdminSection).toContain('contentUrl der Site; leer = Default-Site');
    expect(tableauAdminSection).toContain('aus Tableau: Connected App → Client ID');
    expect(tableauAdminSection).toContain('Secret ID des erzeugten Secrets');
    expect(tableauAdminSection).toContain('Präfix OVP_TABLEAU_; der Wert wird nie hier eingegeben');
  });

  it('shows read-only Issuer URL/JWKS-URL/Key-ID with a copy button, plus an editable Site-ID', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-oauth2-fields"');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-issuer" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-jwks" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-kid" type="text" readonly');
    expect(tableauAdminSection).toContain('id="tableau-server-eas-issuer-copy" type="button" disabled');
    expect(tableauAdminSection).toContain('Kopieren');
    expect(tableauAdminSection).toContain('id="tableau-server-site-id"');
    expect(tableauAdminSection).toContain('Site-LUID, nach dem Anlegen der Connected App in Tableau angezeigt');
  });

  it('warns about a missing HTTPS public URL and links to the login/SSO/license section', () => {
    expect(tableauAdminSection).toContain('id="tableau-server-eas-warning"');
    expect(tableauAdminSection).toMatch(/id="tableau-server-eas-warning"[^>]*hidden/);
    expect(tableauAdminSection).toContain('href="#auth-admin"');
    expect(tableauAdminSection).toContain('Anmeldung, Single Sign-On &amp; Lizenz');
  });

  it('offers a collapsible step-by-step setup block per mode with the exact Tableau dialog fields and the SSO precondition', () => {
    expect(tableauAdminSection).toContain('<details id="tableau-server-setup-connected-app">');
    expect(tableauAdminSection).toContain('<details id="tableau-server-setup-oauth2-trust">');
    expect(tableauAdminSection).toContain('Einrichtung Schritt für Schritt (Direct Trust)');
    expect(tableauAdminSection).toContain('Einrichtung Schritt für Schritt (OAuth 2.0 Trust)');
    // Shared SSO/license precondition, spelled out in both collapsible blocks.
    expect((tableauAdminSection.match(/Lizenz mit den Merkmalen <code>sso<\/code> und <code>tableauServer<\/code>/g) || []).length).toBe(2);
    // Direct Trust: the exact Tableau dialog fields from the spec.
    expect(tableauAdminSection).toContain('New Connected App → Direct Trust');
    expect(tableauAdminSection).toContain('Client ID');
    expect(tableauAdminSection).toContain('Generate New Secret');
    expect(tableauAdminSection).toContain('Secret Value');
    // OAuth 2.0 Trust: the exact Tableau dialog fields from the spec.
    expect(tableauAdminSection).toContain('New Connected App → OAuth 2.0 Trust');
    expect(tableauAdminSection).toContain('Issuer URL');
    expect(tableauAdminSection).toContain('Site ID');
    expect(tableauAdminSection).toContain('.well-known/openid-configuration');
  });

  it('tracks authMode/siteId in the field map and toggles mode visibility without touching the connection-test gating', () => {
    expect(tableauAdminScript).toContain("authMode: document.getElementById('tableau-server-auth-mode')");
    expect(tableauAdminScript).toContain("siteId: document.getElementById('tableau-server-site-id')");
    expect(tableauAdminScript).toContain('function tableauServerUpdateModeVisibility()');
    expect(tableauAdminScript).toContain("key === 'enabled' || key === 'usernameClaim' || key === 'authMode' ? 'change' : 'input'");
    // The existing connection-test gating logic must stay untouched by the new mode.
    expect(tableauAdminScript).toContain('!config.enabled || !tableauServerState.licensed || !tableauServerState.oidcReady');
  });

  it('builds the save payload with authMode and siteId, blanking the fields the other mode ignores', () => {
    expect(tableauAdminScript).toContain('var mode = tableauServerFields.authMode.value;');
    expect(tableauAdminScript).toContain("clientId: mode === 'oauth2-trust' ? '' : tableauServerFields.clientId.value.trim()");
    expect(tableauAdminScript).toContain("siteId: mode === 'oauth2-trust' ? tableauServerFields.siteId.value.trim() : ''");
    expect(tableauAdminScript).toContain('authMode: mode');
  });

  it('renders the eas display fields from state and copes with eas === null', () => {
    expect(tableauAdminScript).toContain('function tableauServerRenderEas()');
    expect(tableauAdminScript).toContain('var eas = tableauServerState.eas;');
    expect(tableauAdminScript).toContain("eas ? eas.issuerUrl : pending");
    expect(tableauAdminScript).toContain("eas ? eas.jwksUrl : pending");
    expect(tableauAdminScript).toContain("eas ? eas.kid : pending");
    expect(tableauAdminScript).toContain("document.getElementById('tableau-server-eas-issuer-copy').disabled = !eas");
    expect(tableauAdminScript).toContain("document.getElementById('tableau-server-eas-warning').hidden = !(eas && eas.publicUrlOk === false)");
    // The initial state must default eas to null so pre-load rendering never throws.
    expect(tableauAdminScript).toContain('eas: null');
  });

  it('never returns or logs a private key — only kid/issuerUrl/jwksUrl reach the script', () => {
    expect(tableauAdminScript).not.toMatch(/privateKey/i);
    expect(tableauAdminSection).not.toMatch(/privateKey/i);
  });
});
