import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TREX_ICON_BASE64 } from '@openvizpilot/shared';

/**
 * Drift-Wächter: Das Manifest-Icon lebt als Base64-Konstante in
 * shared/src/trex.ts (damit auch der Admin-Download der Middleware es ohne
 * Dateisystem-Zugriff einbetten kann). Wer scripts/icon.png per
 * scripts/gen-icon.mjs neu erzeugt, muss die Konstante mitziehen — sonst
 * schlägt dieser Test an, statt dass still das alte Icon ausgeliefert wird.
 */
describe('TREX_ICON_BASE64', () => {
  it('matches scripts/icon.png', () => {
    const iconPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../scripts/icon.png',
    );
    expect(fs.readFileSync(iconPath).toString('base64')).toBe(TREX_ICON_BASE64);
  });
});
