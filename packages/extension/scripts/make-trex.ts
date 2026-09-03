/**
 * Generiert die .trex-Manifestdatei — dieselbe Quelle nutzt der Admin-Download
 * der Middleware (GET /api/admin/trex), siehe @openvizpilot/shared/trex.ts.
 *
 *   npm run build:trex -- --dev                          → public/openvizpilot.dev.trex (localhost:5173)
 *   npm run build:trex -- --url https://chat.example.com → dist/openvizpilot.trex
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTrexManifest, validateExtensionUrl } from '@openvizpilot/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

const { values } = parseArgs({
  options: {
    dev: { type: 'boolean', default: false },
    url: { type: 'string' },
  },
});

const dev = values.dev === true;
const rawUrl = dev ? 'http://localhost:5173/' : values.url;

if (!rawUrl) {
  console.error('Nutzung: make-trex --dev  ODER  make-trex --url https://<extension-host>/');
  process.exit(1);
}
const validation = validateExtensionUrl(rawUrl);
if (!validation.ok || !validation.url) {
  console.error(`Ungültige URL: ${validation.reason}`);
  process.exit(1);
}
if (!dev && !validation.url.startsWith('https://')) {
  console.error('Produktions-URL muss HTTPS sein (Tableau Server lehnt HTTP ab).');
  process.exit(1);
}

const outPath = dev
  ? path.join(pkgRoot, 'public', 'openvizpilot.dev.trex')
  : path.join(pkgRoot, 'dist', 'openvizpilot.trex');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buildTrexManifest({ url: validation.url, dev }));
console.log(`Manifest geschrieben: ${outPath} (source-location: ${validation.url})`);
