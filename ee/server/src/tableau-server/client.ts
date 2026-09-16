import { createHash, createHmac, randomUUID } from 'node:crypto';
import { resolveTableauSecret, tableauConfigSchema, TABLEAU_REST_API_VERSION, type TableauConfig } from './config';
import { signEasJwt, type TableauEasKey } from './eas';
import { TableauError, isTableauError } from './errors';
import { createTableauHttpsTransport, TABLEAU_REQUEST_TIMEOUT_MS, type TableauTransport, type TableauTransportResponse } from './http';
import { METADATA_SEARCH_QUERY, METADATA_FIELD_QUERY } from './metadata-queries';

const CACHE_TTL_MS = 5 * 60_000;
const SCOPE = 'tableau:content:read';
const API_PREFIX = `/api/${TABLEAU_REST_API_VERSION}`;

export interface TableauSignInUser {
  issuer: string;
  sub: string;
  expiresAt: number;
  claims: Readonly<Record<string, unknown>>;
}

export type TableauTime = (() => number) | { now(): number };

export interface TableauClientOptions {
  transport?: TableauTransport;
  time?: TableauTime;
  /** Alias useful to callers that already expose a now function. */
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Required when `config.authMode === 'oauth2-trust'` — the EAS signing key and its issuer URL. */
  eas?: { key: TableauEasKey; issuer: string };
}

interface CachedSession {
  cacheKey: string;
  userKey: string;
  token: string;
  siteId: string;
  userId: string;
  expiresAt: number;
}

type SignInResult = { token: string; siteId: string; userId: string };
export type TableauReadResource = 'serverinfo' | 'workbooks' | 'views' | 'projects' | 'datasources';
interface InFlightSignIn {
  userKey: string;
  operation: Promise<SignInResult>;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function isUsableString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readClock(source: TableauTime | undefined, fallback: () => number): number {
  const value = typeof source === 'function' ? source() : source?.now() ?? fallback();
  if (!Number.isFinite(value)) throw new TableauError('TABLEAU_REQUEST_FAILED');
  return Math.floor(value);
}

function responseJson(response: TableauTransportResponse): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new TableauError('TABLEAU_RESPONSE_INVALID', response.status);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TableauError('TABLEAU_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TableauError('TABLEAU_ABORTED');
}

async function waitForSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TableauError('TABLEAU_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function retryAfterMs(headers: Readonly<Record<string, string>>): number {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  if (!entry) return 0;
  const seconds = Number(entry.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, TABLEAU_REQUEST_TIMEOUT_MS);
  const timestamp = Date.parse(entry);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(timestamp - Date.now(), TABLEAU_REQUEST_TIMEOUT_MS)) : 0;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Tableau answers a REST version it does not serve with error 404001, which is a server-version problem rather than a request failure. */
function isVersionNotFound(response: TableauTransportResponse): boolean {
  if (response.status !== 404) return false;
  try {
    const error = (JSON.parse(response.body) as { error?: { code?: unknown } } | null)?.error;
    return error?.code === '404001';
  } catch {
    return false;
  }
}

function isSafePathSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,200}$/.test(value);
}

export class TableauClient {
  readonly config: TableauConfig;
  private readonly secret: string;
  private readonly secretFingerprint: string;
  private readonly eas: { key: TableauEasKey; issuer: string } | undefined;
  private readonly transport: TableauTransport;
  private readonly time: TableauTime | undefined;
  private readonly fallbackNow: () => number;
  private readonly cache = new Map<string, CachedSession>();
  private readonly cacheIndex = new Map<string, string>();
  private readonly inFlight = new Map<string, InFlightSignIn>();
  private readonly userGenerations = new Map<string, number>();
  private generation = 0;

  constructor(config: TableauConfig, options: TableauClientOptions = {}) {
    try {
      this.config = tableauConfigSchema.parse(config);
    } catch {
      throw new TableauError('TABLEAU_CONFIG_INVALID');
    }
    this.time = options.time;
    this.fallbackNow = options.now ?? (() => Date.now());
    this.transport = options.transport ?? (this.config.enabled
      ? createTableauHttpsTransport(this.config.serverUrl)
      : async () => { throw new TableauError('TABLEAU_DISABLED'); });
    this.eas = options.eas;
    // Direct Trust braucht das Shared Secret; OAuth 2.0 Trust signiert mit dem EAS-Schlüssel
    // (this.eas) und lässt secretEnv absichtlich leer/unbenutzt — resolveTableauSecret würde
    // dafür fehlschlagen.
    this.secret = this.config.enabled && this.config.authMode === 'connected-app'
      ? resolveTableauSecret(this.config, options.env ?? process.env)
      : '';
    this.secretFingerprint = createHash('sha256').update(this.secret, 'utf8').digest('hex');
  }

  private now(): number {
    return readClock(this.time, this.fallbackNow);
  }

  private validateUser(user: TableauSignInUser, now: number): string {
    if (!this.config.enabled) throw new TableauError('TABLEAU_DISABLED');
    if (!isUsableString(user.issuer) || !isUsableString(user.sub)) throw new TableauError('TABLEAU_CLAIM_INVALID');
    if (!Number.isFinite(user.expiresAt) || user.expiresAt <= now) throw new TableauError('TABLEAU_IDENTITY_EXPIRED');
    const username = user.claims[this.config.usernameClaim];
    if (!isUsableString(username)) throw new TableauError('TABLEAU_CLAIM_INVALID');
    return username;
  }

  private userKey(user: Pick<TableauSignInUser, 'issuer' | 'sub'>): string {
    return JSON.stringify([user.issuer, user.sub]);
  }

  /** Identifies the signing key in the cache: the secret fingerprint for Direct Trust, the `kid` for OAuth 2.0 Trust. */
  private get sessionKeyFingerprint(): string {
    return this.config.authMode === 'oauth2-trust' ? this.eas?.key.kid ?? '' : this.secretFingerprint;
  }

  private cacheBaseKey(user: TableauSignInUser, username: string): string {
    return JSON.stringify([
      this.config.revision,
      this.config.serverUrl,
      this.config.siteContentUrl,
      this.config.clientId,
      this.config.secretId,
      this.sessionKeyFingerprint,
      SCOPE,
      user.issuer,
      user.sub,
      username,
    ]);
  }

  private takeExpired(now: number): CachedSession[] {
    const expired: CachedSession[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt > now) continue;
      this.cache.delete(key);
      const baseKey = entry.cacheKey.split('\u0000', 1)[0]!;
      if (this.cacheIndex.get(baseKey) === key) this.cacheIndex.delete(baseKey);
      expired.push(entry);
    }
    return expired;
  }

  private invalidateError(): TableauError {
    return new TableauError('TABLEAU_SIGNIN_INVALIDATED');
  }

  private assertActive(generation: number, userKey: string, userGeneration: number): void {
    if (generation !== this.generation || (this.userGenerations.get(userKey) ?? 0) !== userGeneration) throw this.invalidateError();
  }

  private async signOutToken(token: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.transport({ method: 'POST', path: `${API_PREFIX}/auth/signout`, headers: { accept: 'application/json', 'x-tableau-auth': token }, signal });
    } catch {
      // Sign-out is best effort; the token is never included in the error.
    }
  }

  private signInJwt(username: string, now: number, expiresAt: number): string {
    return this.config.authMode === 'oauth2-trust'
      ? this.signInJwtOauth2Trust(username, now)
      : this.signInJwtDirectTrust(username, now, expiresAt);
  }

  /** Direct Trust (unverändert): HS256 mit dem Connected-App-Secret, an die verbleibende OIDC-Sitzungsdauer gekoppelt. */
  private signInJwtDirectTrust(username: string, now: number, expiresAt: number): string {
    const exp = Math.min(Math.floor(expiresAt / 1000), Math.floor(now / 1000) + 60);
    if (exp <= Math.floor(now / 1000)) throw new TableauError('TABLEAU_IDENTITY_EXPIRED');
    const header = { alg: 'HS256', typ: 'JWT', kid: this.config.secretId, iss: this.config.clientId };
    const payload = { iss: this.config.clientId, sub: username, aud: 'tableau', exp, jti: randomUUID(), scp: [SCOPE] };
    const encodedHeader = base64urlJson(header);
    const encodedPayload = base64urlJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.secret).update(signingInput, 'utf8').digest('base64url');
    return `${signingInput}.${signature}`;
  }

  /** OAuth 2.0 Trust: RS256 mit dem middleware-eigenen EAS-Schlüssel, `aud` gegen die konfigurierte Site-LUID. */
  private signInJwtOauth2Trust(username: string, now: number): string {
    if (!this.eas) throw new TableauError('TABLEAU_EAS_KEY_MISSING');
    return signEasJwt(this.eas.key, { issuer: this.eas.issuer, username, siteId: this.config.siteId, now });
  }

  private async performSignIn(
    user: TableauSignInUser,
    username: string,
    startedAt: number,
    baseKey: string,
    generation: number,
    userGeneration: number,
    signal?: AbortSignal,
  ): Promise<SignInResult> {
    throwIfAborted(signal);
    const jwt = this.signInJwt(username, startedAt, user.expiresAt);
    let response: TableauTransportResponse;
    try {
      response = await this.transport({
        method: 'POST',
        path: `${API_PREFIX}/auth/signin`,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ credentials: { jwt, site: { contentUrl: this.config.siteContentUrl } } }),
        signal,
      });
    } catch (error) {
      if (isTableauError(error)) throw error;
      throw new TableauError('TABLEAU_REQUEST_FAILED');
    }
    throwIfAborted(signal);
    if (isVersionNotFound(response)) throw new TableauError('TABLEAU_VERSION_UNSUPPORTED', response.status);
    if (response.status < 200 || response.status >= 300) throw new TableauError('TABLEAU_AUTH_FAILED', response.status);

    let receivedToken: string | undefined;
    try {
      const root = responseJson(response);
      const credentials = objectValue(root.credentials);
      const tokenValue = credentials.token;
      if (!isUsableString(tokenValue)) throw new TableauError('TABLEAU_RESPONSE_INVALID', response.status);
      receivedToken = tokenValue;
      const site = objectValue(credentials.site);
      const tableauUser = objectValue(credentials.user);
      const siteId = site.id;
      const returnedContentUrl = site.contentUrl;
      const userId = tableauUser.id;
      const returnedUsername = tableauUser.name;
      if (!isSafePathSegment(siteId) || !isUsableString(userId) || typeof returnedContentUrl !== 'string') {
        throw new TableauError('TABLEAU_RESPONSE_INVALID', response.status);
      }
      if (returnedContentUrl !== this.config.siteContentUrl) throw new TableauError('TABLEAU_WRONG_SITE', response.status);
      if (typeof returnedUsername === 'string' && returnedUsername !== username) throw new TableauError('TABLEAU_USER_MISMATCH', response.status);
      if (this.now() >= user.expiresAt) throw new TableauError('TABLEAU_IDENTITY_EXPIRED');
      this.assertActive(generation, this.userKey(user), userGeneration);

      const cacheKey = `${baseKey}\u0000${siteId}`;
      const entry: CachedSession = {
        cacheKey,
        userKey: this.userKey(user),
        token: receivedToken,
        siteId,
        userId,
        expiresAt: Math.min(user.expiresAt, startedAt + CACHE_TTL_MS),
      };
      this.cache.set(cacheKey, entry);
      this.cacheIndex.set(baseKey, cacheKey);
      return { token: receivedToken, siteId, userId };
    } catch (error) {
      if (receivedToken) void this.signOutToken(receivedToken);
      throw error;
    }
  }

  async signIn(user: TableauSignInUser, signal?: AbortSignal): Promise<SignInResult> {
    throwIfAborted(signal);
    const now = this.now();
    const username = this.validateUser(user, now);
    for (const entry of this.takeExpired(now)) void this.signOutToken(entry.token);
    const baseKey = this.cacheBaseKey(user, username);
    const cachedKey = this.cacheIndex.get(baseKey);
    if (cachedKey) {
      const cached = this.cache.get(cachedKey);
      if (cached && cached.expiresAt > now && user.expiresAt > now) return { token: cached.token, siteId: cached.siteId, userId: cached.userId };
      if (cached) {
        this.cache.delete(cachedKey);
        this.cacheIndex.delete(baseKey);
        void this.signOutToken(cached.token);
      }
    }
    const existing = this.inFlight.get(baseKey);
    if (existing) {
      const result = await waitForSignal(existing.operation, signal);
      if (this.now() >= user.expiresAt) throw new TableauError('TABLEAU_IDENTITY_EXPIRED');
      return result;
    }

    const userKey = this.userKey(user);
    const generation = this.generation;
    const userGeneration = this.userGenerations.get(userKey) ?? 0;
    let operation!: Promise<SignInResult>;
    operation = this.performSignIn(user, username, now, baseKey, generation, userGeneration, signal).finally(() => {
      if (this.inFlight.get(baseKey)?.operation === operation) this.inFlight.delete(baseKey);
    });
    this.inFlight.set(baseKey, { userKey, operation });
    return operation;
  }

  /** Remove expired credentials and best-effort sign them out at Tableau. */
  async prune(): Promise<void> {
    await Promise.all(this.takeExpired(this.now()).map((entry) => this.signOutToken(entry.token)));
  }

  async clear(): Promise<void> {
    this.generation += 1;
    const entries = [...this.cache.values()];
    this.cache.clear();
    this.cacheIndex.clear();
    this.inFlight.clear();
    await Promise.all(entries.map((entry) => this.signOutToken(entry.token)));
  }

  async clearUser(issuer: string, sub: string): Promise<void> {
    const userKey = this.userKey({ issuer, sub });
    this.userGenerations.set(userKey, (this.userGenerations.get(userKey) ?? 0) + 1);
    const entries = [...this.cache.values()].filter((entry) => entry.userKey === userKey);
    for (const entry of entries) {
      this.cache.delete(entry.cacheKey);
      const baseKey = entry.cacheKey.split('\u0000', 1)[0]!;
      if (this.cacheIndex.get(baseKey) === entry.cacheKey) this.cacheIndex.delete(baseKey);
    }
    for (const [baseKey, operation] of this.inFlight) {
      if (operation.userKey === userKey) this.inFlight.delete(baseKey);
    }
    await Promise.all(entries.map((entry) => this.signOutToken(entry.token)));
  }

  private readPath(resource: TableauReadResource, siteId?: string, query?: { pageSize?: number; pageNumber?: number }): string {
    const queryEntries = query && typeof query === 'object' ? Object.entries(query) : query === undefined ? [] : undefined;
    if (!queryEntries) throw new TableauError('TABLEAU_QUERY_INVALID');
    if (resource === 'serverinfo') {
      if (queryEntries.length > 0) throw new TableauError('TABLEAU_QUERY_INVALID');
      return `${API_PREFIX}/serverinfo`;
    }
    if (!siteId || !isSafePathSegment(siteId)) throw new TableauError('TABLEAU_RESPONSE_INVALID');
    const params = new URLSearchParams();
    for (const [key, value] of queryEntries) {
      if (value === undefined) continue;
      if (key !== 'pageSize' && key !== 'pageNumber') throw new TableauError('TABLEAU_QUERY_INVALID');
      if (!Number.isInteger(value) || value < 1 || (key === 'pageSize' && value > 1000)) throw new TableauError('TABLEAU_QUERY_INVALID');
      params.set(key, String(value));
    }
    const suffix = params.toString();
    return `${API_PREFIX}/sites/${encodeURIComponent(siteId)}/${resource}${suffix ? `?${suffix}` : ''}`;
  }

  private async readTransport(
    request: { method: 'GET' | 'POST'; path: string; headers: Readonly<Record<string, string>>; body?: string },
    signal: AbortSignal,
    deadline: number,
    retryState: { count: number },
  ): Promise<TableauTransportResponse> {
    while (true) {
      throwIfAborted(signal);
      let response: TableauTransportResponse;
      try {
        response = await this.transport({ ...request, signal });
      } catch (error) {
        if (isTableauError(error)) throw error;
        throw new TableauError('TABLEAU_REQUEST_FAILED');
      }
      throwIfAborted(signal);
      if (!isRetryableStatus(response.status) || retryState.count >= 1) return response;
      retryState.count += 1;
      const delay = retryAfterMs(response.headers);
      if (Date.now() + delay >= deadline) throw new TableauError('TABLEAU_TIMEOUT');
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = () => { signal.removeEventListener('abort', onAbort); resolve(); };
        const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new TableauError('TABLEAU_ABORTED')); };
        timer = setTimeout(finish, delay);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  async read(
    user: TableauSignInUser,
    resource: TableauReadResource,
    query?: { pageSize?: number; pageNumber?: number },
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!['serverinfo', 'workbooks', 'views', 'projects', 'datasources'].includes(resource)) {
      throw new TableauError('TABLEAU_ENDPOINT_FORBIDDEN');
    }
    return this.requestJson(user, resource !== 'serverinfo', (session) => ({
      method: 'GET', path: this.readPath(resource, session?.siteId, query),
    }), signal);
  }

  async queryMetadata(user: TableauSignInUser, document: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (document !== METADATA_SEARCH_QUERY && document !== METADATA_FIELD_QUERY) throw new TableauError('TABLEAU_QUERY_INVALID');
    const body = JSON.stringify({ query: document, variables });
    if (Buffer.byteLength(body, 'utf8') > 32_768) throw new TableauError('TABLEAU_QUERY_INVALID');
    return this.requestJson(user, true, () => ({ method: 'POST', path: '/api/metadata/graphql', body }), signal);
  }

  private async requestJson(
    user: TableauSignInUser,
    authenticated: boolean,
    request: (session?: SignInResult) => { method: 'GET' | 'POST'; path: string; body?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    throwIfAborted(signal);
    const controller = new AbortController();
    const deadline = Date.now() + TABLEAU_REQUEST_TIMEOUT_MS;
    let timedOut = false;
    const deadlineTimer = setTimeout(() => { timedOut = true; controller.abort(); }, TABLEAU_REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const effectiveSignal = controller.signal;
      let siteSession = authenticated ? await this.signIn(user, effectiveSignal) : undefined;
      if (!authenticated) this.validateUser(user, this.now());
      const activeUserKey = this.userKey(user);
      let activeGeneration = this.generation;
      let activeUserGeneration = this.userGenerations.get(activeUserKey) ?? 0;
      let authRetries = 0;
      const retryState = { count: 0 };
      while (true) {
        const response = await this.readTransport({
          ...request(siteSession),
          headers: {
            accept: 'application/json', 'content-type': 'application/json',
            ...(siteSession ? { 'x-tableau-auth': siteSession.token } : {}),
          },
        }, effectiveSignal, deadline, retryState);
        this.assertActive(activeGeneration, activeUserKey, activeUserGeneration);
        if (response.status === 401 && authenticated && authRetries < 1) {
          authRetries += 1;
          void this.clearUser(user.issuer, user.sub);
          siteSession = await this.signIn(user, effectiveSignal);
          activeGeneration = this.generation;
          activeUserGeneration = this.userGenerations.get(activeUserKey) ?? 0;
          continue;
        }
        if (response.status === 401) throw new TableauError('TABLEAU_AUTH_FAILED', response.status);
        if (isVersionNotFound(response)) throw new TableauError('TABLEAU_VERSION_UNSUPPORTED', response.status);
        if (response.status < 200 || response.status >= 300) throw new TableauError('TABLEAU_HTTP_ERROR', response.status);
        this.validateUser(user, this.now());
        return responseJson(response);
      }
    } catch (error) {
      if (timedOut) throw new TableauError('TABLEAU_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
