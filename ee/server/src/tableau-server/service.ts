import { createHmac, randomUUID } from 'node:crypto';
import type { VerifiedUser } from '../oidc';
import type { PersonalizationLogger } from '../personalization';
import { TableauClient } from './client';
import { resolveTableauSecret, type TableauConfig } from './config';
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
}

export class TableauServiceError extends Error {
  constructor(readonly code: 'license_required' | 'oidc_required' | 'tableau_disabled' | 'tableau_changed' | 'tableau_unavailable' | 'tableau_busy') {
    super(code);
  }
}

type Client = Pick<TableauClient, 'signIn' | 'clear' | 'clearUser' | 'prune' | 'read' | 'queryMetadata'>;

export class TableauService {
  private active: { key: string; client: Client } | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private running = 0;

  constructor(
    readonly store: TableauStore,
    readonly access: () => Promise<TableauAccess>,
    private readonly logger: PersonalizationLogger,
    private readonly salt: () => Promise<string>,
    private readonly makeClient: (config: TableauConfig) => Client = (config) => new TableauClient(config),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.timer = setInterval(() => { void this.reconcile(); }, 30_000);
    this.timer.unref();
  }

  async invalidate(): Promise<void> {
    const previous = this.active;
    this.active = null;
    if (previous) await previous.client.clear().catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    void this.invalidate();
  }

  private async snapshot() {
    const access = await this.access();
    if (!access.licensed) throw new TableauServiceError('license_required');
    if (!access.oidcReady) throw new TableauServiceError('oidc_required');
    const { config } = await this.store.get();
    if (!config?.enabled) throw new TableauServiceError('tableau_disabled');
    const secret = resolveTableauSecret(config, this.env);
    const key = createHmac('sha256', secret).update(JSON.stringify([config, access.identityRevision])).digest('hex');
    return { config, access, key };
  }

  private async reconcile(): Promise<void> {
    if (!this.active) return;
    try {
      const current = this.active;
      const { key } = await this.snapshot();
      if (this.active !== current) return;
      if (current.key !== key) await this.invalidate();
      else await current.client.prune();
    } catch {
      await this.invalidate();
    }
  }

  private verifyUser(user: VerifiedUser, access: TableauAccess, config: TableauConfig): void {
    if (user.issuer !== access.issuer || !Number.isFinite(user.expiresAt) || user.expiresAt <= Date.now()) {
      throw new TableauServiceError('oidc_required');
    }
    const claim = user.claims[config.usernameClaim];
    if (typeof claim !== 'string' || !claim.trim()) throw new TableauError('TABLEAU_CLAIM_INVALID');
  }

  async available(user: VerifiedUser | undefined): Promise<boolean> {
    if (!user || this.stopped) return false;
    try {
      const { access, config } = await this.snapshot();
      this.verifyUser(user, access, config);
      return true;
    } catch { return false; }
  }

  private async run<T>(user: VerifiedUser, operation: string, work: (client: Client, config: TableauConfig, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.running >= 8) throw new TableauServiceError('tableau_busy');
    this.running += 1;
    const started = Date.now();
    const requestId = randomUUID();
    const deadline = AbortSignal.timeout(10_000);
    const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let actor: string | undefined;
    let used: { key: string; client: Client } | null = null;
    try {
      if (this.stopped) throw new TableauServiceError('tableau_unavailable');
      const { config, access, key } = await this.snapshot();
      this.verifyUser(user, access, config);
      actor = createHmac('sha256', await this.salt()).update(JSON.stringify(['tableau', user.issuer, user.sub])).digest('hex');
      operationSignal.throwIfAborted();
      if (this.active?.key !== key) {
        // Swap synchronously; a slow sign-out must not overwrite a newer client.
        const old = this.active;
        this.active = { key, client: this.makeClient(config) };
        if (old) void old.client.clear().catch(() => undefined);
      }
      const active = this.active;
      used = active;
      const result = await work(active.client, config, operationSignal);
      const after = await this.snapshot();
      if (after.key !== key || this.active !== active || this.stopped || user.expiresAt <= Date.now()) {
        void active.client.clear().catch(() => undefined);
        throw new TableauServiceError('tableau_changed');
      }
      operationSignal.throwIfAborted();
      this.logger.info('tableau operation', { requestId, actor, operation, result: 'ok', durationMs: Date.now() - started });
      return result;
    } catch (error) {
      if (error instanceof TableauServiceError && used && this.active === used) void this.invalidate();
      this.logger.warn('tableau operation', { requestId, actor, operation, result: 'failed', durationMs: Date.now() - started });
      throw error;
    } finally {
      this.running -= 1;
    }
  }

  async check(user: VerifiedUser): Promise<{ ok: true; stage: 'authentication' }> {
    return this.run(user, 'signin', async (client) => {
      await client.signIn(user);
      return { ok: true, stage: 'authentication' };
    });
  }

  async connectionCheck(user: VerifiedUser, signal?: AbortSignal) {
    return this.run(user, 'connection_check', (client, config, boundedSignal) => new TableauRest(client, config).check(user, boundedSignal), signal);
  }

  async search(user: VerifiedUser, input: TableauSearchInput, signal?: AbortSignal) {
    const parsed = tableauSearchSchema.parse(input);
    return this.run(user, 'content_search', (client, config, boundedSignal) => new TableauRest(client, config).search(user, parsed, boundedSignal), signal);
  }

  async logout(user: VerifiedUser): Promise<void> {
    await this.active?.client.clearUser(user.issuer, user.sub);
  }

  async metadataSearch(user: VerifiedUser, input: TableauMetadataSearchInput, signal?: AbortSignal) {
    const parsed = tableauMetadataSearchSchema.parse(input);
    return this.run(user, 'metadata_search', (client, config, boundedSignal) => new TableauMetadata(client, config).search(user, parsed, boundedSignal), signal);
  }

  async metadataField(user: VerifiedUser, input: TableauMetadataFieldInput, signal?: AbortSignal) {
    const parsed = tableauMetadataFieldSchema.parse(input);
    return this.run(user, 'metadata_field', (client, config, boundedSignal) => new TableauMetadata(client, config).field(user, parsed, boundedSignal), signal);
  }
}
