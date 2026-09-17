import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isSecretKeyConfigured, SecretsError } from '../server/src/secrets';

const KEY_ENV = { OVP_SECRET_KEY: 'a-secret-key-that-is-at-least-32-chars-long' };

describe('Secrets: AES-256-GCM encryption for web-stored secrets', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const box = encryptSecret('super-secret-value', KEY_ENV);
    expect(box.v).toBe(1);
    expect(box.data).not.toContain('super-secret-value');
    expect(decryptSecret(box, KEY_ENV)).toBe('super-secret-value');
  });

  it('produces a fresh IV per call, so identical plaintexts encrypt differently', () => {
    const first = encryptSecret('same-value', KEY_ENV);
    const second = encryptSecret('same-value', KEY_ENV);
    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('throws secret_key_missing without a configured (or too short) OVP_SECRET_KEY', () => {
    expect(() => encryptSecret('value', {})).toThrow(SecretsError);
    try { encryptSecret('value', {}); } catch (error) { expect((error as SecretsError).code).toBe('secret_key_missing'); }
    expect(() => encryptSecret('value', { OVP_SECRET_KEY: 'too-short' })).toThrow(SecretsError);
  });

  it('never decrypts under the wrong key or once the ciphertext/tag has been tampered with', () => {
    const box = encryptSecret('value', KEY_ENV);
    expect(() => decryptSecret(box, { OVP_SECRET_KEY: 'a-different-secret-key-32-chars!!' })).toThrow(SecretsError);
    expect(() => decryptSecret({ ...box, tag: box.tag.slice(0, -2) + 'AA' }, KEY_ENV)).toThrow(SecretsError);
  });

  it('reports whether a usable key is configured, without revealing it', () => {
    expect(isSecretKeyConfigured({})).toBe(false);
    expect(isSecretKeyConfigured({ OVP_SECRET_KEY: 'short' })).toBe(false);
    expect(isSecretKeyConfigured(KEY_ENV)).toBe(true);
  });
});
