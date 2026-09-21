import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_ENV_NAMES, loadEnv } from '../src/env';

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OVP_LLM_BASE_URL: 'http://localhost:9',
    OVP_LLM_API_KEY: 'test',
    OVP_DEFAULT_MODEL: 'test',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LEGACY_ENV_NAMES', () => {
  it('maps every current env var to its old LiteLLM-era name', () => {
    expect(LEGACY_ENV_NAMES).toEqual({
      OVP_LLM_BASE_URL: 'LITELLM_BASE_URL',
      OVP_LLM_API_KEY: 'LITELLM_API_KEY',
      OVP_DEFAULT_MODEL: 'DEFAULT_MODEL',
      OVP_MODEL_ALLOWLIST: 'MODEL_ALLOWLIST',
      OVP_ALLOWED_ORIGINS: 'ALLOWED_ORIGINS',
      OVP_SERVE_STATIC_DIR: 'SERVE_STATIC_DIR',
      OVP_API_AUTH_TOKEN: 'API_AUTH_TOKEN',
      OVP_ADMIN_TOKEN: 'ADMIN_TOKEN',
      OVP_DATABASE_URL: 'MEMORY_DATABASE_URL',
      OVP_DATABASE_PATH: 'MEMORY_DB_PATH',
      OVP_MEMORY_MODEL: 'MEMORY_MODEL',
      OVP_SCOPE_GUARD: 'SCOPE_GUARD',
      OVP_SCOPE_MODEL: 'SCOPE_MODEL',
      OVP_LOG_LEVEL: 'LOG_LEVEL',
      OVP_AUTH_MODE: 'AUTH_MODE',
      OVP_PUBLIC_URL: 'PUBLIC_URL',
      OVP_OIDC_PROVIDER: 'OIDC_PROVIDER',
      OVP_OIDC_ISSUER: 'OIDC_ISSUER',
      OVP_OIDC_CLIENT_ID: 'OIDC_CLIENT_ID',
      OVP_OIDC_CLIENT_SECRET: 'OIDC_CLIENT_SECRET',
      OVP_OIDC_SCOPES: 'OIDC_SCOPES',
      OVP_APP_VERSION: 'APP_VERSION',
    });
  });
});

describe('loadEnv legacy fallback', () => {
  it('accepts the old env var names when the new ones are unset', () => {
    const config = loadEnv({
      LITELLM_BASE_URL: 'http://legacy:9',
      LITELLM_API_KEY: 'legacy-key',
      DEFAULT_MODEL: 'legacy-model',
      MODEL_ALLOWLIST: 'legacy-model,other',
      ADMIN_TOKEN: 'legacy-admin',
      MEMORY_DB_PATH: ':memory:',
      LOG_LEVEL: 'error',
    });
    expect(config.litellmBaseUrl).toBe('http://legacy:9');
    expect(config.litellmApiKey).toBe('legacy-key');
    expect(config.defaultModel).toBe('legacy-model');
    expect(config.modelAllowlist).toEqual(['legacy-model', 'other']);
    expect(config.adminToken).toBe('legacy-admin');
    expect(config.memoryDbPath).toBe(':memory:');
    expect(config.logLevel).toBe('error');
  });

  it('prefers the new env var name when both old and new are set', () => {
    const config = loadEnv(
      baseEnv({
        DEFAULT_MODEL: 'legacy-model',
        OVP_DEFAULT_MODEL: 'current-model',
      }),
    );
    expect(config.defaultModel).toBe('current-model');
  });

  it('still ignores an empty new value and falls back to the old one', () => {
    const config = loadEnv(
      baseEnv({
        ADMIN_TOKEN: 'legacy-admin',
        OVP_ADMIN_TOKEN: '',
      }),
    );
    expect(config.adminToken).toBe('legacy-admin');
  });

  it('warns exactly once at startup, listing every legacy name used', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadEnv(
      baseEnv({
        LITELLM_BASE_URL: 'http://legacy:9',
        LITELLM_API_KEY: 'legacy-key',
        OVP_LLM_BASE_URL: undefined,
        OVP_LLM_API_KEY: undefined,
        ADMIN_TOKEN: 'legacy-admin',
      }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('LITELLM_BASE_URL ist veraltet — bitte OVP_LLM_BASE_URL verwenden');
    expect(message).toContain('LITELLM_API_KEY ist veraltet — bitte OVP_LLM_API_KEY verwenden');
    expect(message).toContain('ADMIN_TOKEN ist veraltet — bitte OVP_ADMIN_TOKEN verwenden');
  });

  it('does not warn when only the current env var names are used', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadEnv(baseEnv());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('removed license public-key override', () => {
  it('warns but does not fail startup when the removed env vars are still set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadEnv(baseEnv({ OVP_LICENSE_PUBLIC_KEY_B64URL: 'irgendwas', OVP_LICENSE_PUBLIC_KEY_PATH: '/tmp/does-not-matter' }));
    expect(warn).toHaveBeenCalledWith('OVP_LICENSE_PUBLIC_KEY_B64URL wird ignoriert: der Vertrauensanker ist fest eingebaut');
    expect(warn).toHaveBeenCalledWith('OVP_LICENSE_PUBLIC_KEY_PATH wird ignoriert: der Vertrauensanker ist fest eingebaut');
    // Der Wert erreicht die Konfiguration nirgends — kein Env-Pfad zu den Vertrauensankern.
    expect(config.licenseEnv).toEqual({ OVP_LICENSE: undefined, OVP_LICENSE_PATH: undefined });
    expect(config.licenseTrustedKeys).toBeUndefined();
  });

  it('does not warn when the removed env vars are unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadEnv(baseEnv());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('Watch (W6): SMTP env and enable switch', () => {
  it('defaults SMTP to unset and the watch switch to enabled', () => {
    const config = loadEnv(baseEnv());
    expect(config.smtpUrl).toBeNull();
    expect(config.smtpFrom).toBeNull();
    expect(config.watchEnabled).toBe(true);
  });

  it('reads OVP_SMTP_URL and OVP_SMTP_FROM when set', () => {
    const config = loadEnv(baseEnv({ OVP_SMTP_URL: 'smtps://user:pass@mail.example.com:465', OVP_SMTP_FROM: 'alerts@example.com' }));
    expect(config.smtpUrl).toBe('smtps://user:pass@mail.example.com:465');
    expect(config.smtpFrom).toBe('alerts@example.com');
  });

  it('rejects an OVP_SMTP_URL that is not a valid URL', () => {
    expect(() => loadEnv(baseEnv({ OVP_SMTP_URL: 'not-a-url' }))).toThrow(/OVP_SMTP_URL/);
  });

  it('treats OVP_WATCH_ENABLED=false as disabled and an empty value as unset (default on)', () => {
    expect(loadEnv(baseEnv({ OVP_WATCH_ENABLED: 'false' })).watchEnabled).toBe(false);
    expect(loadEnv(baseEnv({ OVP_WATCH_ENABLED: 'true' })).watchEnabled).toBe(true);
    expect(loadEnv(baseEnv({ OVP_WATCH_ENABLED: '' })).watchEnabled).toBe(true);
  });
});

describe('OVP_ENVIRONMENT', () => {
  it('defaults to production, treats an empty value as unset and accepts only the four environments', () => {
    expect(loadEnv(baseEnv()).environment).toBe('production');
    expect(loadEnv(baseEnv({ OVP_ENVIRONMENT: '' })).environment).toBe('production');
    for (const environment of ['production', 'development', 'test', 'staging'] as const) {
      expect(loadEnv(baseEnv({ OVP_ENVIRONMENT: environment })).environment).toBe(environment);
    }
    expect(() => loadEnv(baseEnv({ OVP_ENVIRONMENT: 'prod' }))).toThrow(/OVP_ENVIRONMENT/);
    // Lease-Vertrauensanker sind fest eingebaut — kein Env-Pfad.
    expect(loadEnv(baseEnv()).leaseTrustedKeys).toBeUndefined();
  });
});
