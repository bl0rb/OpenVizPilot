import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHeartbeatPayload,
  createSqliteTelemetryStore,
  describeTelemetry,
  encodeLicenseToken,
  HEARTBEAT_INTERVAL_MS,
  LICENSE_FORMAT_VERSION,
  sendHeartbeatOnce,
  signLicensePayload,
  verifyLicense,
  type LicenseStatus,
  type SqliteLike,
} from '../server/src/index';

/**
 * Lizenz-Heartbeat: Was gesendet wird, wann gesendet wird — und vor allem,
 * wann NICHT. Ohne gültige Lizenz und ohne Endpunkt darf nie ein Aufruf nach
 * außen gehen, und ein Ausfall der Gegenstelle darf nichts kaputt machen.
 */

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteLike & { close(): void };
};

let tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovp-telemetry-'));
  tmpDirs.push(dir);
  return createSqliteTelemetryStore(new DatabaseSync(path.join(dir, 'db.sqlite')));
}

function licence(overrides: Record<string, unknown> = {}): { token: string; status: LicenseStatus } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = JSON.stringify({
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: 'lic-1',
    tier: 'enterprise',
    licensee: 'Beispiel GmbH',
    issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  });
  const token = encodeLicenseToken(payload, signLicensePayload(payload, privateKey));
  return { token, status: verifyLicense(token, publicKey) };
}

function collectingFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response('{}', { status: 200 });
  };
  return { calls, impl };
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined };

describe('heartbeat payload', () => {
  it('carries only the licence token, an installation id, the version and two counts', () => {
    const payload = buildHeartbeatPayload({
      installationId: 'inst-1',
      license: 'token',
      version: '0.3.0',
      usage: { activeUsers30d: 12, dashboards: 4 },
      now: new Date('2026-09-03T10:00:00Z'),
    });

    expect(Object.keys(payload).sort()).toEqual(['installationId', 'license', 'schema', 'sentAt', 'usage', 'version']);
    expect(Object.keys(payload.usage).sort()).toEqual(['activeUsers30d', 'dashboards']);
    expect(payload.sentAt).toBe('2026-09-03T10:00:00.000Z');
    // Nichts Erfundenes: keine Namen, IDs, Hostnamen oder Dashboard-Bezeichnungen.
    expect(JSON.stringify(payload)).not.toMatch(/dashboardKey|userToken|hostname|licensee/i);
  });

  it('never reports fractional or negative counts', () => {
    const payload = buildHeartbeatPayload({
      installationId: 'i',
      license: 't',
      version: 'v',
      usage: { activeUsers30d: -3, dashboards: 2.7 },
    });
    expect(payload.usage).toEqual({ activeUsers30d: 0, dashboards: 2 });
  });
});

describe('sending', () => {
  const usage = async () => ({ activeUsers30d: 3, dashboards: 2 });

  it('sends once per interval for a valid licence and reports the licence verbatim', async () => {
    const { token, status } = licence();
    const { calls, impl } = collectingFetch();
    const deps = {
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status, token }),
      version: '0.3.0-rc.1',
      store: store(),
      usage,
      logger,
      fetchImpl: impl,
    };

    expect(await sendHeartbeatOnce(deps, 1_000)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://telemetry.example/heartbeat.php');
    expect(calls[0]?.body.license).toBe(token);
    expect(calls[0]?.body.usage).toEqual({ activeUsers30d: 3, dashboards: 2 });

    // Zweiter Versuch im selben Intervall: kein weiterer Aufruf.
    expect(await sendHeartbeatOnce(deps, 2_000)).toBe('skipped');
    expect(calls).toHaveLength(1);

    // Nach Ablauf des Intervalls wieder.
    expect(await sendHeartbeatOnce(deps, 1_000 + HEARTBEAT_INTERVAL_MS)).toBe('sent');
    expect(calls).toHaveLength(2);
    // Dieselbe Installation behält ihre ID.
    expect(calls[1]?.body.installationId).toBe(calls[0]?.body.installationId);
  });

  it('stays silent without a licence, with an expired one and without an endpoint', async () => {
    const { calls, impl } = collectingFetch();
    const base = { version: 'v', store: store(), usage, logger, fetchImpl: impl };

    const none: LicenseStatus = { status: 'none' };
    expect(await sendHeartbeatOnce({ ...base, endpoint: 'https://x/hb', license: async () => ({ status: none, token: null }) })).toBe('skipped');

    const expired = licence({ validUntil: new Date(Date.now() - 1000).toISOString() });
    expect(expired.status.status).toBe('expired');
    expect(
      await sendHeartbeatOnce({ ...base, endpoint: 'https://x/hb', license: async () => ({ status: expired.status, token: expired.token }) }),
    ).toBe('skipped');

    const valid = licence();
    expect(await sendHeartbeatOnce({ ...base, endpoint: '', license: async () => ({ status: valid.status, token: valid.token }) })).toBe('skipped');

    expect(calls).toHaveLength(0);
  });

  it('survives an unreachable endpoint and records the failure', async () => {
    const { token, status } = licence();
    const telemetry = store();
    const failing: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const result = await sendHeartbeatOnce({
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status, token }),
      version: 'v',
      store: telemetry,
      usage,
      logger,
      fetchImpl: failing,
    });

    expect(result).toBe('failed');
    const state = await telemetry.getHeartbeatState();
    expect(state.lastOkAt).toBeNull();
    expect(state.lastDetail).toBe('TypeError');
  });

  it('treats a rejecting endpoint as a failure without throwing', async () => {
    const { token, status } = licence();
    const telemetry = store();
    const rejecting: typeof fetch = async () => new Response('nope', { status: 403 });

    expect(
      await sendHeartbeatOnce({
        endpoint: 'https://telemetry.example/heartbeat.php',
        license: async () => ({ status, token }),
        version: 'v',
        store: telemetry,
        usage,
        logger,
        fetchImpl: rejecting,
      }),
    ).toBe('failed');
    expect((await telemetry.getHeartbeatState()).lastDetail).toBe('HTTP 403');
  });

  it('survives a database outage while claiming the interval and says so', async () => {
    const { token, status } = licence();
    const warnings: string[] = [];
    const broken = { ...store(), claimHeartbeat: async () => { throw new Error('pg connection lost'); } };

    const result = await sendHeartbeatOnce({
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status, token }),
      version: 'v',
      store: broken,
      usage,
      logger: { ...logger, warn: (msg: string) => void warnings.push(msg) },
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });

    // Kein Fehler nach oben — aber auch kein stilles Verschlucken.
    expect(result).toBe('failed');
    expect(warnings.join(' ')).toMatch(/claim/i);
  });

  it('lets only one replica claim an interval', async () => {
    const telemetry = store();
    const claims = await Promise.all([
      telemetry.claimHeartbeat(5_000, HEARTBEAT_INTERVAL_MS),
      telemetry.claimHeartbeat(5_000, HEARTBEAT_INTERVAL_MS),
      telemetry.claimHeartbeat(5_000, HEARTBEAT_INTERVAL_MS),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe('describeTelemetry (Admin-UI)', () => {
  it('explains why it is inactive for open core and lists what would be sent', async () => {
    const none: LicenseStatus = { status: 'none' };
    const described = await describeTelemetry({
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status: none, token: null }),
      store: store(),
    });

    expect(described.active).toBe(false);
    expect(described.reason).toMatch(/Open-Core/);
    expect(described.sends.length).toBeGreaterThan(0);
    expect(described.neverSends.join(' ')).toMatch(/Fragen/);
  });

  it('reports an active heartbeat with its last result', async () => {
    const { token, status } = licence();
    const telemetry = store();
    const { impl } = collectingFetch();
    await sendHeartbeatOnce({
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status, token }),
      version: 'v',
      store: telemetry,
      usage: async () => ({ activeUsers30d: 1, dashboards: 1 }),
      logger,
      fetchImpl: impl,
    });

    const described = await describeTelemetry({
      endpoint: 'https://telemetry.example/heartbeat.php',
      license: async () => ({ status, token }),
      store: telemetry,
    });
    expect(described.active).toBe(true);
    expect(described.lastOkAt).not.toBeNull();
    expect(described.lastDetail).toBe('ok');
  });
});
