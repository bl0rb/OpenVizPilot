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
