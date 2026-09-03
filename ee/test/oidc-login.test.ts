import { describe, expect, it } from 'vitest';
import { buildAuthorizationUrl, parseRedirectFragment, pkceChallenge } from '../extension/src/oidc-login';

describe('extension OIDC login helpers', () => {
  it('builds a PKCE S256 challenge (RFC 7636 test vector)', async () => {
    // Verifier/Challenge aus RFC 7636 Anhang B
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('builds the authorization URL with all required parameters', () => {
    const url = new URL(
      buildAuthorizationUrl(
        {
          mode: 'oidc',
          provider: 'entra',
          authorizationEndpoint: 'https://login.microsoftonline.com/t/oauth2/v2.0/authorize',
          clientId: 'app-id',
          scopes: 'openid profile email',
          redirectUri: 'https://chat.example.com/auth/callback',
        },
        { state: 'st', codeChallenge: 'ch' },
      ),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://chat.example.com/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('refuses to build a URL from an incomplete config', () => {
    expect(() => buildAuthorizationUrl({ mode: 'oidc' }, { state: 's', codeChallenge: 'c' })).toThrow(/unvollständig/);
  });

  it('parses the same-window return fragment and ignores foreign hashes', () => {
    expect(parseRedirectFragment('#openvizpilot-oidc&code=abc&state=st')).toEqual({ code: 'abc', state: 'st', error: null });
    expect(parseRedirectFragment('#openvizpilot-oidc&error=access_denied&state=st')).toEqual({ code: null, state: 'st', error: 'access_denied' });
    expect(parseRedirectFragment('#/settings')).toBeNull();
    expect(parseRedirectFragment('')).toBeNull();
  });
});
