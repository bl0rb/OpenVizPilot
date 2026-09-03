import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * OIDC für die Middleware (Enterprise): Discovery, JWKS, Verifikation von
 * ID-Tokens (RS256) und der Authorization-Code-Austausch als Backend-for-
 * Frontend — die Extension hält nie ein Client-Secret und spricht den
 * Token-Endpunkt nie direkt an (CORS-frei, Secret bleibt serverseitig).
 *
 * Unterstützt: Microsoft Entra ID (Issuer
 * https://login.microsoftonline.com/<tenant>/v2.0) und Keycloak (Issuer
 * https://<host>/realms/<realm>) — beide liefern RS256-signierte ID-Tokens
 * mit `kid` und ein Standard-Discovery-Dokument. Andere Standard-OIDC-
 * Provider funktionieren mit provider "generic".
 *
 * Bewusst ohne zusätzliche Dependency: JWT-Verifikation über node:crypto
 * (JWK → KeyObject, RSA-SHA256), Discovery/JWKS über fetch.
 */

export type OidcProvider = 'entra' | 'keycloak' | 'generic';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  /** Nur für confidential clients — public clients (PKCE) brauchen keins. */
  clientSecret?: string;
  scopes: string;
  provider: OidcProvider;
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface VerifiedUser {
  /** Stabiler Subject-Identifier des IdP — die vertrauenswürdige Nutzer-ID. */
  sub: string;
  email?: string;
  name?: string;
  /** Ablauf des Tokens (Epoch-Millisekunden). */
  expiresAt: number;
}

export class OidcError extends Error {
  constructor(
    message: string,
    /** 'config' = Server-Konfiguration/IdP nicht erreichbar, 'token' = Token abgelehnt. */
    readonly kind: 'config' | 'token',
  ) {
    super(message);
  }
}

const CLOCK_SKEW_S = 60;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/** Mindestabstand zwischen erzwungenen JWKS-Abrufen (unbekannter kid). */
const FORCED_REFRESH_COOLDOWN_MS = 60_000;
const JWKS_TTL_MS = 60 * 60 * 1000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

function b64urlJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export const PROVIDER_LABELS: Record<OidcProvider, string> = {
  entra: 'Microsoft Entra ID',
  keycloak: 'Keycloak',
  generic: 'Single Sign-On',
};

export class OidcClient {
  private discoveryCache: { at: number; value: Discovery } | null = null;
  private jwksCache: { at: number; keys: Jwk[] } | null = null;
  private jwksInflight: Promise<Jwk[]> | null = null;
  private lastForcedRefreshAt = 0;

  constructor(
    readonly settings: OidcSettings,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async discovery(): Promise<Discovery> {
    if (this.discoveryCache && Date.now() - this.discoveryCache.at < DISCOVERY_TTL_MS) {
      return this.discoveryCache.value;
    }
    const url = `${this.settings.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new OidcError(`OIDC-Discovery nicht erreichbar (${url}): ${err instanceof Error ? err.message : String(err)}`, 'config');
    }
    if (!res.ok) throw new OidcError(`OIDC-Discovery fehlgeschlagen (HTTP ${res.status}) unter ${url}`, 'config');
    const doc = (await res.json()) as Partial<Discovery>;
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new OidcError('OIDC-Discovery-Dokument unvollständig (issuer/authorization_endpoint/token_endpoint/jwks_uri)', 'config');
    }
    this.discoveryCache = { at: Date.now(), value: doc as Discovery };
    return this.discoveryCache.value;
  }

  /**
   * JWKS mit Cache; `forceRefresh` (unbekannter kid, z. B. nach Schlüssel-
   * rotation beim IdP) ist gedrosselt: höchstens ein erzwungener Abruf je
   * FORCED_REFRESH_COOLDOWN_MS und nie mehrere gleichzeitig — sonst könnte
   * jeder unauthentifizierte Request mit zufälligem kid einen Abruf beim
   * IdP auslösen (Amplifikation gegen den Identity-Provider).
   */
  private async jwks(forceRefresh = false): Promise<Jwk[]> {
    if (!forceRefresh && this.jwksCache && Date.now() - this.jwksCache.at < JWKS_TTL_MS) {
      return this.jwksCache.keys;
    }
    if (forceRefresh) {
      if (Date.now() - this.lastForcedRefreshAt < FORCED_REFRESH_COOLDOWN_MS && this.jwksCache) return this.jwksCache.keys;
      this.lastForcedRefreshAt = Date.now();
    }
    if (this.jwksInflight) return this.jwksInflight;
    this.jwksInflight = this.fetchJwks().finally(() => {
      this.jwksInflight = null;
    });
    return this.jwksInflight;
  }

  private async fetchJwks(): Promise<Jwk[]> {
    const { jwks_uri } = await this.discovery();
    let res: Response;
    try {
      res = await this.fetchImpl(jwks_uri, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new OidcError(`JWKS nicht erreichbar (${jwks_uri}): ${err instanceof Error ? err.message : String(err)}`, 'config');
    }
    if (!res.ok) throw new OidcError(`JWKS-Abruf fehlgeschlagen (HTTP ${res.status})`, 'config');
    const body = (await res.json()) as { keys?: Jwk[] };
    this.jwksCache = { at: Date.now(), keys: body.keys ?? [] };
    return this.jwksCache.keys;
  }

  /** Authorization-URL für den Popup-Login (Authorization Code + PKCE). */
  async authorizationUrl(params: { redirectUri: string; state: string; codeChallenge: string }): Promise<string> {
    const { authorization_endpoint } = await this.discovery();
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.settings.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', this.settings.scopes);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (this.settings.provider === 'entra') url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  /**
   * Verifiziert ein ID-Token: RS256-Signatur gegen den JWKS-Schlüssel mit
   * passendem kid, Issuer, Audience (= client_id), Zeitfenster (±60 s).
   */
  async verifyIdToken(token: string, now: number = Date.now()): Promise<VerifiedUser> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcError('Token hat kein JWT-Format', 'token');
    let header: { alg?: string; kid?: string; typ?: string };
    let payload: Record<string, unknown>;
    try {
      header = b64urlJson(parts[0]!) as typeof header;
      payload = b64urlJson(parts[1]!) as Record<string, unknown>;
    } catch {
      throw new OidcError('Token nicht dekodierbar', 'token');
    }
    if (header.alg !== 'RS256') throw new OidcError(`Nicht unterstützter Signaturalgorithmus: ${header.alg ?? '?'}`, 'token');
    if (!header.kid) throw new OidcError('Token ohne kid', 'token');

    // Plausibilität VOR jedem Netzwerkzugriff: Issuer, Audience und Ablauf
    // stehen im (noch unsignierten) Payload — ein offensichtlich fremdes oder
    // abgelaufenes Token darf keinen JWKS-Abruf beim IdP auslösen.
    const nowS = Math.floor(now / 1000);
    const configuredIssuer = this.settings.issuer.replace(/\/$/, '');
    if (typeof payload.iss !== 'string' || payload.iss.replace(/\/$/, '') !== configuredIssuer) {
      throw new OidcError('Token-Issuer passt nicht zur Konfiguration', 'token');
    }
    const aud = payload.aud;
    const audOk = Array.isArray(aud) ? aud.includes(this.settings.clientId) : aud === this.settings.clientId;
    if (!audOk) throw new OidcError('Token-Audience passt nicht zur client_id', 'token');
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    if (exp + CLOCK_SKEW_S < nowS) throw new OidcError('Token abgelaufen', 'token');

    let key = (await this.jwks()).find((k) => k.kid === header.kid);
    if (!key) key = (await this.jwks(true)).find((k) => k.kid === header.kid);
    if (!key || key.kty !== 'RSA' || !key.n || !key.e) throw new OidcError('Signaturschlüssel unbekannt (kid)', 'token');

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    let ok = false;
    try {
      const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
      ok = cryptoVerify('RSA-SHA256', signingInput, publicKey, Buffer.from(parts[2]!, 'base64url'));
    } catch {
      ok = false;
    }
    if (!ok) throw new OidcError('Token-Signatur ungültig', 'token');

    // Issuer zusätzlich gegen das Discovery-Dokument (exakter Wert des IdP).
    const { issuer } = await this.discovery();
    if (payload.iss !== issuer) throw new OidcError('Token-Issuer passt nicht zur Konfiguration', 'token');
    const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined;
    if (nbf !== undefined && nbf - CLOCK_SKEW_S > nowS) throw new OidcError('Token noch nicht gültig', 'token');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new OidcError('Token ohne Subject', 'token');

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      expiresAt: exp * 1000,
    };
  }

  /** Tauscht den Authorization Code (PKCE) gegen ein verifiziertes ID-Token. */
  async exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string; user: VerifiedUser }> {
    const { token_endpoint } = await this.discovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: this.settings.clientId,
      code_verifier: params.codeVerifier,
    });
    if (this.settings.clientSecret) body.set('client_secret', this.settings.clientSecret);
    let res: Response;
    try {
      res = await this.fetchImpl(token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new OidcError(`Token-Endpunkt nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, 'config');
    }
    const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !json.id_token) {
      // Provider-Fehlertexte nicht 1:1 an den Browser reichen (CWE-209) — nur die Klasse.
      throw new OidcError(`Code-Austausch abgelehnt (${json.error ?? `HTTP ${res.status}`})`, 'token');
    }
    const user = await this.verifyIdToken(json.id_token);
    return { idToken: json.id_token, user };
  }
}
