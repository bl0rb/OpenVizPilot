/**
 * Lizenz-Werkzeug für Entwicklung/Betrieb, bis der WerkWorks-Lizenzgenerator
 * produktübergreifend ist (gleiches Token-Format):
 *
 *   npm run sign-license -w @openvizpilot/ee -- keygen ./keys
 *   npm run sign-license -w @openvizpilot/ee -- sign ./keys/private.pem "Firma GmbH" 2027-12-31 [sso]
 *   npm run sign-license -w @openvizpilot/ee -- verify ./keys/public.pem <token>
 */
import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encodeLicenseToken, LICENSE_FORMAT_VERSION, publicKeyFromPem, signLicensePayload, verifyLicense } from '../server/src/license';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'keygen') {
  const dir = args[0] ?? './keys';
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
  fs.writeFileSync(path.join(dir, 'public.pem'), publicKey.export({ format: 'pem', type: 'spki' }));
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  fs.writeFileSync(path.join(dir, 'public.b64url'), jwk.x);
  console.log(`Schlüsselpaar in ${dir}/ — OVP_LICENSE_PUBLIC_KEY_B64URL=${jwk.x}`);
} else if (cmd === 'sign') {
  const [keyPath, licensee, validUntil, featuresCsv] = args;
  if (!keyPath || !licensee || !validUntil) {
    console.error('Nutzung: sign <private.pem> <Lizenznehmer> <YYYY-MM-DD> [feature,feature]');
    process.exit(1);
  }
  const payload = {
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: randomUUID(),
    tier: 'enterprise',
    licensee,
    issuedAt: new Date().toISOString(),
    validUntil: new Date(`${validUntil}T23:59:59Z`).toISOString(),
    ...(featuresCsv ? { features: featuresCsv.split(',').map((f) => f.trim()) } : {}),
  };
  const json = JSON.stringify(payload);
  const token = encodeLicenseToken(json, signLicensePayload(json, createPrivateKey(fs.readFileSync(keyPath, 'utf8'))));
  console.log(token);
} else if (cmd === 'verify') {
  const [pubPath, token] = args;
  if (!pubPath || !token) {
    console.error('Nutzung: verify <public.pem> <token>');
    process.exit(1);
  }
  console.log(JSON.stringify(verifyLicense(token, publicKeyFromPem(fs.readFileSync(pubPath, 'utf8'))), null, 2));
} else {
  console.error('Befehle: keygen [dir] | sign <private.pem> <Lizenznehmer> <YYYY-MM-DD> [features] | verify <public.pem> <token>');
  process.exit(1);
}
