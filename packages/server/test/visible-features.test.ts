import { describe, expect, it } from 'vitest';
import { EE_STUB, type LicenseStatus } from '@openvizpilot/ee/server';
import { visibleFeatures } from '../src/app';

// Die Extension darf nur anbieten, was der Server auch ausführt — sonst erscheint z. B. „Gesamte
// Umgebung“, und der Chat stuft still zurück (gleiche Hürden wie routes/chat.ts und ee/watch/routes.ts).
function license(features: string[]): LicenseStatus {
  return { status: 'valid', license: { effectiveFeatures: features } } as unknown as LicenseStatus;
}
const ALL = ['sso', 'memory', 'savedQueries', 'mcp', 'actions', 'tableauServer', 'serverData', 'watch'];
const fullAccess = { ai: true, tableauApi: true, serverData: true };

describe.skipIf(EE_STUB)('visibleFeatures (/api/features)', () => {
  it('offers serverData and watch only with every licence and both grants', () => {
    expect(visibleFeatures(license(ALL), fullAccess)).toMatchObject({ serverData: true, watch: true, tableauServer: true });
  });

  it('hides serverData and watch without the Tableau-API grant even with the Serverdaten grant', () => {
    expect(visibleFeatures(license(ALL), { ai: true, tableauApi: false, serverData: true })).toMatchObject({ serverData: false, watch: false, tableauServer: false });
  });

  it('hides serverData and watch without the Serverdaten grant', () => {
    expect(visibleFeatures(license(ALL), { ai: true, tableauApi: true, serverData: false })).toMatchObject({ serverData: false, watch: false });
  });

  it('hides serverData without the tableauServer or sso licence feature', () => {
    expect(visibleFeatures(license(ALL.filter((f) => f !== 'tableauServer')), fullAccess)).toMatchObject({ serverData: false, watch: false });
    expect(visibleFeatures(license(ALL.filter((f) => f !== 'sso')), fullAccess)).toMatchObject({ serverData: false, watch: false });
  });

  it('hides watch without its own licence feature', () => {
    expect(visibleFeatures(license(ALL.filter((f) => f !== 'watch')), fullAccess)).toMatchObject({ serverData: true, watch: false });
  });

  it('shows nothing without a valid licence or access', () => {
    expect(Object.values(visibleFeatures({ status: 'none' }, fullAccess)).some(Boolean)).toBe(false);
    expect(Object.values(visibleFeatures(license(ALL), undefined)).some(Boolean)).toBe(false);
  });
});
