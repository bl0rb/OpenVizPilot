import { EE_STUB, type LeaseRecord, type TelemetryStore } from '@openvizpilot/ee/server';
import { describe, expect, it } from 'vitest';
import { createAuthStateProvider, LEASE_GRACE_MS, resolveLeaseState } from '../src/auth-state';
import type { AppConfig } from '../src/env';
import { createLogger } from '../src/logger';
import { signTestLease, testLicenseEnv } from './license-helper';

/**
 * Effektive Lizenz = Signatur UND Lease-Zustand (auth-state.ts): pending → Core,
 * erste Lease → active, abgelaufene Lease < 30 Tage → grace (Enterprise an),
 * darüber → expired, Aktivierungslimit ohne gültige Lease → blocked. Alle
 * Zeitvergleiche laufen über die injizierte Uhr — kein Test wartet.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-09-19T12:00:00Z');

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: 'http://127.0.0.1:1',
    litellmApiKey: 'sk-test',
    defaultModel: 'test-model',
    modelAllowlist: null,
    port: 0,
    allowedOrigins: [],
    serveStaticDir: null,
    apiAuthToken: null,
    adminToken: null,
    memoryDatabaseUrl: null,
    memoryDbPath: null,
    memoryModel: 'memory-model',
    scopeGuardEnabled: false,
    scopeModel: 'scope-model',
    logLevel: 'error',
    authMode: 'none',
    publicUrl: null,
    oidc: null,
    telemetryEndpoint: '',
    appVersion: 'test',
    environment: 'production',
    licenseEnv: {},
    ...overrides,
  };
}

/** Telemetrie-Store im Speicher — nur das, was auth-state liest. */
function fakeTelemetry(record: Partial<LeaseRecord> = {}): TelemetryStore & { record: LeaseRecord } {
  const state: LeaseRecord = { leaseToken: null, leaseState: 'none', leaseMessage: null, activationFirstAttemptAt: null, ...record };
  return {
    record: state,
    getInstallationId: async () => 'inst-1',
    claimHeartbeat: async () => false,
    recordHeartbeatResult: async () => undefined,
    getHeartbeatState: async () => ({ lastAttemptAt: null, lastOkAt: null, lastDetail: null }),
    getLease: async () => ({ ...state }),
    recordActivationAttempt: async () => undefined,
    saveLease: async () => undefined,
    recordActivationLimit: async () => undefined,
    recordDeactivation: async () => undefined,
  };
}

async function stateAt(telemetry: TelemetryStore | null, nowMs: number, extra: Partial<AppConfig> = {}) {
  const provider = createAuthStateProvider(config({ ...testLicenseEnv(['sso', 'memory'], new Date(T0 + 400 * DAY).toISOString()), ...extra }), null, createLogger('error'), telemetry, () => new Date(nowMs));
  return provider.get();
}

const lease = (leaseUntilMs: number, extra: { offline?: boolean; installationId?: string; licenseId?: string } = {}) =>
  signTestLease({ installationId: extra.installationId ?? 'inst-1', licenseId: extra.licenseId, leaseUntil: new Date(leaseUntilMs).toISOString(), offline: extra.offline });

// Testet die reale Lizenz-/Lease-Verifikation (verifyLicense/verifyLease) —
// im Core-Export (EE_STUB) ist jede Lizenz 'none'/'invalid', diese Suite
// läuft nur im vollen Baum.
describe.skipIf(EE_STUB)('lease state', () => {
  it('starts an installation that never held a lease in pending — Core functions only', async () => {
    const state = await stateAt(fakeTelemetry(), T0);
    expect(state.verifiedLicense.status).toBe('valid');
    expect(state.lease).toMatchObject({ state: 'pending', leaseUntil: null, graceUntil: null, installationId: 'inst-1', environment: 'production' });
    expect(state.license.status).toBe('inactive');
    if (state.license.status === 'inactive') expect(state.license.reason).toMatch(/noch nicht aktiviert/);
    // Auch ein längst vergangener erster Versuch ändert nichts: ohne Lease keine Enterprise-Funktionen.
    expect((await stateAt(fakeTelemetry({ activationFirstAttemptAt: T0 - 100 * DAY }), T0)).lease.state).toBe('pending');
  });

  it('treats a deactivated installation like pending (Core) with its own message', async () => {
    const state = await stateAt(fakeTelemetry({ leaseState: 'deactivated' }), T0);
    expect(state.lease).toMatchObject({ state: 'pending', serverState: 'deactivated' });
    expect(state.lease.message).toMatch(/stillgelegt.*Jetzt aktualisieren/);
    expect(state.license.status).toBe('inactive');

    // Ein erneuter Heartbeat mit frischer Lease reaktiviert wie gewohnt.
    const reactivated = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY), leaseState: 'active' }), T0);
    expect(reactivated.lease.state).toBe('active');
  });

  it('becomes active with the first lease (online or offline) and an activation limit does not invalidate a valid lease', async () => {
    const active = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY), leaseState: 'active' }), T0);
    expect(active.lease).toMatchObject({ state: 'active', offline: false, leaseUntil: new Date(T0 + 7 * DAY).toISOString(), message: null });
    expect(active.license.status).toBe('valid');

    const offline = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 300 * DAY, { offline: true }), leaseState: 'active' }), T0 + 200 * DAY);
    expect(offline.lease).toMatchObject({ state: 'active', offline: true });
    expect(offline.license.status).toBe('valid');

    const limited = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY), leaseState: 'activation_limit', leaseMessage: 'Limit' }), T0 + 3 * DAY);
    expect(limited.lease).toMatchObject({ state: 'active', message: 'Limit' });
    expect(limited.license.status).toBe('valid');
  });

  it('keeps Enterprise on for 30 days after a lease expired (grace) and switches to expired afterwards', async () => {
    const telemetry = fakeTelemetry({ leaseToken: lease(T0), leaseState: 'active' });
    const grace = await stateAt(telemetry, T0 + 29 * DAY);
    expect(grace.lease).toMatchObject({ state: 'grace', leaseUntil: new Date(T0).toISOString(), graceUntil: new Date(T0 + LEASE_GRACE_MS).toISOString() });
    expect(grace.license.status).toBe('valid');

    const expired = await stateAt(telemetry, T0 + 31 * DAY);
    expect(expired.lease.state).toBe('expired');
    expect(expired.license.status).toBe('inactive');
    if (expired.license.status === 'inactive') expect(expired.license.reason).toMatch(/abgelaufen/);
  });

  it('is blocked when the server reported an activation limit and no valid lease exists', async () => {
    const never = await stateAt(fakeTelemetry({ leaseState: 'activation_limit', leaseMessage: 'Lizenz erlaubt 1 produktive Installation, 2 aktiv' }), T0);
    expect(never.lease).toMatchObject({ state: 'blocked', message: 'Lizenz erlaubt 1 produktive Installation, 2 aktiv' });
    expect(never.license.status).toBe('inactive');
    if (never.license.status === 'inactive') expect(never.license.reason).toMatch(/blockiert.*2 aktiv.*übertragen/);

    // Frühere Lease abgelaufen + Limit gemeldet: blockiert, nicht Karenz.
    const lapsed = await stateAt(fakeTelemetry({ leaseToken: lease(T0), leaseState: 'activation_limit', leaseMessage: 'Limit' }), T0 + 2 * DAY);
    expect(lapsed.lease).toMatchObject({ state: 'blocked', leaseUntil: new Date(T0).toISOString() });
    expect(lapsed.license.status).toBe('inactive');
  });

  it('ignores leases for another installation, licence or an untrusted key', async () => {
    expect((await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY, { installationId: 'inst-9' }), leaseState: 'active' }), T0)).lease.state).toBe('pending');
    expect((await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY, { licenseId: 'other' }), leaseState: 'active' }), T0)).lease.state).toBe('pending');
    // Lease-Schlüssel kommen nur aus der programmatischen Map: mit dem eingebauten Anker ist der Test-kid unbekannt.
    const untrusted = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY), leaseState: 'active' }), T0, { leaseTrustedKeys: undefined });
    expect(untrusted.lease.state).toBe('pending');
    expect(untrusted.license.status).toBe('inactive');
  });

  it('never widens the licence: no database means pending, no licence stays none, features come from the licence only', async () => {
    const noDb = await stateAt(null, T0);
    expect(noDb.lease.state).toBe('pending');
    expect(noDb.license.status).toBe('inactive');
    const info = resolveLeaseState({ license: { status: 'none' }, installationId: 'inst-1', record: { leaseToken: lease(T0 + 7 * DAY), leaseState: 'active', leaseMessage: null, activationFirstAttemptAt: null }, environment: 'test', now: new Date(T0) });
    expect(info.state).toBe('pending');
    const state = await stateAt(fakeTelemetry({ leaseToken: lease(T0 + 7 * DAY), leaseState: 'active' }), T0, { licenseEnv: {}, licenseTrustedKeys: undefined });
    expect(state.license.status).toBe('none');
  });

  it('blocks SSO with the activation reason while pending or after grace', async () => {
    const sso = { authMode: 'oidc' as const, publicUrl: 'https://chat.example.com', oidc: { provider: 'generic' as const, issuer: 'https://idp.example', clientId: 'c', clientSecret: null, scopes: 'openid' } };
    expect((await stateAt(fakeTelemetry(), T0, sso)).blockedReason).toMatch(/noch nicht aktiviert.*Single Sign-On/);
    expect((await stateAt(fakeTelemetry({ leaseToken: lease(T0), leaseState: 'active' }), T0 + 40 * DAY, sso)).blockedReason).toMatch(/abgelaufen.*Single Sign-On/);
    expect((await stateAt(fakeTelemetry({ leaseToken: lease(T0), leaseState: 'active' }), T0 + 10 * DAY, sso)).blockedReason).toBeNull();
  });
});
