import { createHmac, randomUUID } from 'node:crypto';
import type { VerifiedUser } from '../oidc';
import type { PersonalizationLogger } from '../personalization';
import { TableauClient } from './client';
import { resolveTableauSecret, resolveTableauSite, type TableauConfig, type TableauServerConfig, type TableauSite } from './config';
import { easIssuerUrl, type TableauEasKey } from './eas';
import type { TableauStore } from './store';
import { TableauRest } from './rest';
import { tableauSearchSchema, type TableauSearchInput } from './schema';
import { TableauError } from './errors';
import { TableauMetadata } from './metadata';
import { tableauMetadataSearchSchema, tableauMetadataFieldSchema, type TableauMetadataSearchInput, type TableauMetadataFieldInput } from './metadata-schema';

export interface TableauAccess {
  licensed: boolean;
  oidcReady: boolean;
  issuer: string | null;
  /** Changes to OIDC configuration must invalidate cached Tableau sessions. */
  identityRevision: string;
  /** Öffentliche URL der Middleware (Admin-UI/PUBLIC_URL) — Grundlage der EAS-Issuer-URL im oauth2-trust-Modus. */
  publicUrl: string | null;
}

/** Wählt eine Site: `siteId` (Admin-Werkzeuge) zuerst, sonst `dashboardKey`, sonst die einzige konfigurierte Site. */
export type TableauSiteSelector = { siteId?: string; dashboardKey?: string };

type TableauEasContext = { key: TableauEasKey; issuer: string } | null;

export class TableauServiceError extends Error {
  constructor(readonly code: 'license_required' | 'oidc_required' | 'tableau_disabled' | 'tableau_changed' | 'tableau_unavailable' | 'tableau_busy') {
    super(code);
  }
}

type Client = Pick<TableauClient, 'signIn' | 'clear' | 'clearUser' | 'prune' | 'read' | 'queryMetadata'>;

/** Baut das flache Laufzeit-`TableauConfig` einer aufgelösten Site aus den globalen Feldern — unverändert das, was TableauClient/-Rest/-Metadata erwarten. */
function toClientConfig(config: TableauServerConfig, site: TableauSite): TableauConfig {
  return {
    enabled: true,
    serverUrl: config.serverUrl,
    siteContentUrl: site.contentUrl,
    clientId: site.clientId,
    secretId: site.secretId,
    secretEnv: site.secretEnv,
    secret: site.secret,
    usernameClaim: config.usernameClaim,
    siteId: site.siteId,
    revision: config.revision,
    apiVersion: config.apiVersion,
    authMode: site.authMode,
  };
}

export class TableauService {
  /** Ein Client je aufgelöster Site (Site-ID → Client), statt eines einzelnen aktiven Clients. */
  private clients = new Map<string, { key: string; client: Client }>();
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private running = 0;

  constructor(
    readonly store: TableauStore,
    readonly access: () => Promise<TableauAccess>,
    private readonly logger: PersonalizationLogger,
    private readonly salt: () => Promise<string>,
    private readonly makeClient: (config: TableauConfig, eas: TableauEasContext) => Client = (config, eas) => new TableauClient(config, { eas: eas ?? undefined }),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.timer = setInterval(() => { void this.reconcile(); }, 30_000);
    this.timer.unref();
  }

  private async dropSite(siteId: string): Promise<void> {
    const entry = this.clients.get(siteId);
    if (!entry) return;
    this.clients.delete(siteId);
    await entry.client.clear().catch(() => undefined);
  }

  async invalidate(): Promise<void> {
    const siteIds = [...this.clients.keys()];
    await Promise.all(siteIds.map((siteId) => this.dropSite(siteId)));
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    void this.invalidate();
  }

  /**
   * Für `oauth2-trust`: lädt den persistierten EAS-Schlüssel und leitet die Issuer-URL aus der
   * Public URL ab. Beides muss vorhanden sein (der Admin-Route legt den Schlüssel beim ersten
   * Speichern an) — fehlt eines, ist die Middleware aus Tableau-Sicht nicht erreichbar/konfiguriert.
   * Ein gemeinsamer EAS-Schlüssel bedient alle Sites im oauth2-trust-Modus.
   */
  private async easContext(access: TableauAccess): Promise<TableauEasContext> {
    const key = await this.store.getEasKey();
    if (!key || !access.publicUrl) throw new TableauServiceError('tableau_unavailable');
    try {
      return { key, issuer: easIssuerUrl(access.publicUrl) };
    } catch {
      throw new TableauServiceError('tableau_unavailable');
    }
  }

  private async siteMaterial(config: TableauServerConfig, site: TableauSite, access: TableauAccess): Promise<{ material: string; eas: TableauEasContext }> {
    if (site.authMode === 'oauth2-trust') {
      const eas = await this.easContext(access);
      return { material: eas!.key.privateKeyPem, eas };
    }
    return { material: resolveTableauSecret(site, this.env), eas: null };
  }

  private async snapshot(selector: TableauSiteSelector = {}) {
    const access = await this.access();
    if (!access.licensed) throw new TableauServiceError('license_required');
    if (!access.oidcReady) throw new TableauServiceError('oidc_required');
    const { config } = await this.store.get();
    if (!config?.enabled) throw new TableauServiceError('tableau_disabled');
    const site = resolveTableauSite(config, selector);
    const { material, eas } = await this.siteMaterial(config, site, access);
    // Der Cache-Invalidierungs-Schlüssel bindet an das jeweils geheime Material: das Shared Secret
    // bei Direct Trust, den privaten EAS-Schlüssel bei OAuth 2.0 Trust (Rotation kommt später).
    const key = createHmac('sha256', material).update(JSON.stringify([config.serverUrl, config.usernameClaim, site, access.identityRevision])).digest('hex');
    return { config, site, access, key, eas, clientConfig: toClientConfig(config, site) };
  }

  private async reconcile(): Promise<void> {
    if (this.clients.size === 0) return;
    try {
      const access = await this.access();
      const { config } = await this.store.get();
      if (!access.licensed || !access.oidcReady || !config?.enabled) {
        await this.invalidate();
        return;
      }
      for (const [siteId, current] of [...this.clients]) {
        const site = config.sites.find((candidate) => candidate.id === siteId);
        if (!site) { await this.dropSite(siteId); continue; }
        try {
          const { material } = await this.siteMaterial(config, site, access);
          const key = createHmac('sha256', material).update(JSON.stringify([config.serverUrl, config.usernameClaim, site, access.identityRevision])).digest('hex');
          if (this.clients.get(siteId) !== current) continue;
          if (current.key !== key) await this.dropSite(siteId);
          else await current.client.prune();
        } catch {
          await this.dropSite(siteId);
        }
      }
    } catch {
      await this.invalidate();
    }
  }

  private verifyUser(user: VerifiedUser, access: TableauAccess, config: TableauServerConfig): void {
    if (user.issuer !== access.issuer || !Number.isFinite(user.expiresAt) || user.expiresAt <= Date.now()) {
      throw new TableauServiceError('oidc_required');
    }
    const claim = user.claims[config.usernameClaim];
    if (typeof claim !== 'string' || !claim.trim()) throw new TableauError('TABLEAU_CLAIM_INVALID');
  }

  async available(user: VerifiedUser | undefined, dashboardKey?: string): Promise<boolean> {
    if (!user || this.stopped) return false;
    try {
      const { access, config } = await this.snapshot({ dashboardKey });
      this.verifyUser(user, access, config);
      return true;
    } catch { return false; }
  }

  private async run<T>(
    user: VerifiedUser,
    operation: string,
    selector: TableauSiteSelector,
    work: (client: Client, config: TableauConfig, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.running >= 8) throw new TableauServiceError('tableau_busy');
    this.running += 1;
    const started = Date.now();
    const requestId = randomUUID();
    const deadline = AbortSignal.timeout(10_000);
    const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let actor: string | undefined;
    let used: { key: string; client: Client } | null = null;
    let siteId: string | undefined;
    try {
      if (this.stopped) throw new TableauServiceError('tableau_unavailable');
      const { config, site, access, key, eas, clientConfig } = await this.snapshot(selector);
      siteId = site.id;
      this.verifyUser(user, access, config);
      actor = createHmac('sha256', await this.salt()).update(JSON.stringify(['tableau', user.issuer, user.sub])).digest('hex');
      operationSignal.throwIfAborted();
      const existing = this.clients.get(site.id);
      let active = existing;
      if (!active || active.key !== key) {
        // Swap synchronously; a slow sign-out must not overwrite a newer client.
        active = { key, client: this.makeClient(clientConfig, eas) };
        this.clients.set(site.id, active);
        if (existing) void existing.client.clear().catch(() => undefined);
      }
      used = active;
      const result = await work(active.client, clientConfig, operationSignal);
      const after = await this.snapshot(selector);
      if (after.key !== key || this.clients.get(site.id) !== active || this.stopped || user.expiresAt <= Date.now()) {
        void active.client.clear().catch(() => undefined);
        throw new TableauServiceError('tableau_changed');
      }
      operationSignal.throwIfAborted();
      this.logger.info('tableau operation', { requestId, actor, operation, site: siteId, result: 'ok', durationMs: Date.now() - started });
      return result;
    } catch (error) {
      if (error instanceof TableauServiceError && used && siteId && this.clients.get(siteId) === used) void this.dropSite(siteId);
      this.logger.warn('tableau operation', { requestId, actor, operation, site: siteId, result: 'failed', durationMs: Date.now() - started });
      throw error;
    } finally {
      this.running -= 1;
    }
  }

  async check(user: VerifiedUser, dashboardKey?: string): Promise<{ ok: true; stage: 'authentication' }> {
    return this.run(user, 'signin', { dashboardKey }, async (client) => {
      await client.signIn(user);
      return { ok: true, stage: 'authentication' };
    });
  }

  async connectionCheck(user: VerifiedUser, selector: TableauSiteSelector = {}, signal?: AbortSignal) {
    return this.run(user, 'connection_check', selector, (client, config, boundedSignal) => new TableauRest(client, config).check(user, boundedSignal), signal);
  }

  async search(user: VerifiedUser, input: TableauSearchInput, signal?: AbortSignal) {
    const parsed = tableauSearchSchema.parse(input);
    return this.run(user, 'content_search', { dashboardKey: parsed.dashboardKey }, (client, config, boundedSignal) => new TableauRest(client, config).search(user, parsed, boundedSignal), signal);
  }

  async logout(user: VerifiedUser): Promise<void> {
    await Promise.all([...this.clients.values()].map((entry) => entry.client.clearUser(user.issuer, user.sub)));
  }

  async metadataSearch(user: VerifiedUser, input: TableauMetadataSearchInput, signal?: AbortSignal) {
    const parsed = tableauMetadataSearchSchema.parse(input);
    return this.run(user, 'metadata_search', { dashboardKey: parsed.dashboardKey }, (client, config, boundedSignal) => new TableauMetadata(client, config).search(user, parsed, boundedSignal), signal);
  }

  async metadataField(user: VerifiedUser, input: TableauMetadataFieldInput, signal?: AbortSignal) {
    const parsed = tableauMetadataFieldSchema.parse(input);
    return this.run(user, 'metadata_field', { dashboardKey: parsed.dashboardKey }, (client, config, boundedSignal) => new TableauMetadata(client, config).field(user, parsed, boundedSignal), signal);
  }
}
