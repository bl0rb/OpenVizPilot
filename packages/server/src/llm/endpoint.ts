import OpenAI from 'openai';
import { z } from 'zod';
import type { AppConfig } from '../env';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';
import { decryptSecret, encryptedSecretSchema } from '../secret-box';
import { createLLMClient } from './client';

/**
 * Effektiver LLM-Endpunkt — zur Laufzeit aus zwei Quellen (wie die Anmeldung, auth-state.ts):
 *
 * 1. Env/Helm (OVP_LLM_BASE_URL, OVP_LLM_API_KEY) als Bootstrap-Default.
 * 2. Admin-UI (admin_settings, id 2): Adresse plus API-Key, der Key AES-GCM-verschlüsselt
 *    mit OVP_SECRET_KEY. Eine Überschreibung hat IMMER einen eigenen Key — der Env-Key wird
 *    nie an eine in der UI eingetragene Adresse geschickt.
 *
 * Ist eine gespeicherte Überschreibung nicht lesbar (Key nicht entschlüsselbar, oder DB beim
 * Start nicht erreichbar), wird NICHT still auf den Env-Endpunkt zurückgefallen: Der Admin
 * kann die Überschreibung gewählt haben, damit Dashboard-Daten einen bestimmten Endpunkt
 * nicht verlassen. LLM-Aufrufe scheitern dann kontrolliert, bis das behoben ist.
 */

export const llmEndpointSettingsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: encryptedSecretSchema,
  updatedAt: z.string(),
});
export type LlmEndpointSettings = z.infer<typeof llmEndpointSettingsSchema>;

export interface LlmEndpointState {
  source: 'env' | 'admin';
  baseUrl: string;
  /** Nur intern (Client, Verbindungstest) — nie in Antworten oder Logs. */
  apiKey: string;
  updatedAt: string | null;
  blockedReason: string | null;
}

export interface LlmEndpointProvider {
  /** Leitet jeden Zugriff an den aktuell wirksamen Client weiter (Routen halten nur diese Referenz). */
  client: OpenAI;
  /** Vor jedem API-Request: lädt die Admin-Einstellung nach Ablauf des Caches neu (andere Replicas). */
  refresh(): Promise<void>;
  current(): LlmEndpointState;
  /** Nach Speichern/Zurücksetzen in der Admin-UI — wirkt sofort. */
  invalidate(): Promise<void>;
}

/** Wie auth-state.ts: kurz genug, dass Änderungen auf anderen Replicas zeitnah greifen. */
const CACHE_TTL_MS = 15_000;

/** Nur Adresse normalisieren (ohne abschließenden Slash), sonst gelten gleiche Adressen als verschieden. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Letzte vier Zeichen, damit erkennbar ist, WELCHER Key wirkt — bei kurzen Keys gar nichts. */
export function apiKeyHint(key: string): string | null {
  return key.length >= 16 ? `…${key.slice(-4)}` : null;
}

export function createLlmEndpointProvider(config: AppConfig, store: MemoryStore | null, logger: Logger): LlmEndpointProvider {
  const envState: LlmEndpointState = {
    source: 'env',
    baseUrl: config.litellmBaseUrl,
    apiKey: config.litellmApiKey,
    updatedAt: null,
    blockedReason: null,
  };
  let state: LlmEndpointState = store
    ? { ...envState, blockedReason: 'LLM-Einstellungen werden geladen.' }
    : envState;
  let active = createLLMClient(config);
  let activeKey = `${config.litellmBaseUrl}\n${config.litellmApiKey}`;
  let loadedAt = store ? 0 : Number.POSITIVE_INFINITY;
  let loaded = !store;
  let inflight: Promise<void> | null = null;

  const apply = (next: LlmEndpointState) => {
    const key = `${next.baseUrl}\n${next.apiKey}`;
    // Gesperrt: kein Client ohne Key bauen — der Proxy lässt ohnehin keinen Aufruf durch.
    if (!next.blockedReason && key !== activeKey) {
      active = createLLMClient({ litellmBaseUrl: next.baseUrl, litellmApiKey: next.apiKey });
      activeKey = key;
    }
    if (next.source !== state.source || next.baseUrl !== state.baseUrl || next.blockedReason !== state.blockedReason) {
      logger.info('LLM-Endpunkt', {
        source: next.source,
        origin: safeOrigin(next.baseUrl),
        ...(next.blockedReason ? { blocked: next.blockedReason } : {}),
      });
    }
    state = next;
  };

  const load = async () => {
    let stored: LlmEndpointSettings | null;
    try {
      stored = await store!.getLlmEndpointSettings();
    } catch (err) {
      logger.warn('llm endpoint settings read failed', { name: err instanceof Error ? err.name : 'unknown' });
      // Mit gültigem Stand weiterarbeiten; ohne einen solchen bleibt der Endpunkt gesperrt.
      if (!loaded) apply({ ...envState, blockedReason: 'LLM-Einstellungen nicht lesbar (Datenbank nicht erreichbar).' });
      loadedAt = Date.now();
      return;
    }
    loaded = true;
    loadedAt = Date.now();
    if (!stored) {
      apply(envState);
      return;
    }
    try {
      apply({ source: 'admin', baseUrl: stored.baseUrl, apiKey: decryptSecret(stored.apiKey), updatedAt: stored.updatedAt, blockedReason: null });
    } catch {
      apply({
        source: 'admin',
        baseUrl: stored.baseUrl,
        apiKey: '',
        updatedAt: stored.updatedAt,
        blockedReason: 'Gespeicherter API-Key nicht entschlüsselbar — OVP_SECRET_KEY prüfen oder Überschreibung zurücksetzen.',
      });
    }
  };

  const reload = () => {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const client = new Proxy({} as OpenAI, {
    get(_target, prop) {
      if (state.blockedReason) {
        // Wie ein nicht erreichbarer Endpunkt — die Routen melden das bereits kontrolliert.
        throw new OpenAI.APIConnectionError({ message: state.blockedReason });
      }
      const value: unknown = Reflect.get(active, prop, active);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(active) : value;
    },
  });

  return {
    client,
    async refresh() {
      if (Date.now() - loadedAt >= CACHE_TTL_MS) await reload();
    },
    current: () => state,
    async invalidate() {
      if (!store) return;
      loadedAt = 0;
      await reload();
    },
  };
}

/** Für Logs nur der Origin — kein Pfad, keine Query. */
export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid';
  }
}

export type LlmEndpointErrorKind = 'auth' | 'not_found' | 'timeout' | 'network' | 'http' | 'invalid_response';

export interface LlmEndpointTestResult {
  ok: boolean;
  baseUrl: string;
  /** Aufgerufene Adresse: dieselbe Abfrage wie „Vom Endpunkt laden“. */
  requestUrl: string;
  status: number | null;
  latencyMs: number;
  modelCount: number | null;
  defaultModel: string;
  defaultModelListed: boolean | null;
  error: { kind: LlmEndpointErrorKind; message: string; code?: string } | null;
}

/** Zeitlimit des Verbindungstests — kürzer als im Betrieb, damit die UI nicht hängt. */
export const LLM_TEST_TIMEOUT_MS = 15_000;

/** Stabile Node-Codes (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED …), nie Meldungstexte. */
function networkCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * GET {baseUrl}/models mit dem angegebenen Key — Ergebnis mit festen, deutschen Meldungen
 * statt roher Upstream-Fehler (diese können Interna des Endpunkts enthalten).
 */
export async function testLlmEndpoint(
  endpoint: { baseUrl: string; apiKey: string },
  defaultModel: string,
  timeoutMs = LLM_TEST_TIMEOUT_MS,
): Promise<LlmEndpointTestResult> {
  const testClient = createLLMClient({ litellmBaseUrl: endpoint.baseUrl, litellmApiKey: endpoint.apiKey }, timeoutMs);
  const base = { baseUrl: endpoint.baseUrl, requestUrl: `${endpoint.baseUrl}/models`, defaultModel };
  const started = Date.now();
  try {
    const list = await testClient.models.list();
    const ids = list.data.map((m) => m.id);
    return {
      ...base,
      ok: true,
      status: 200,
      latencyMs: Date.now() - started,
      modelCount: ids.length,
      defaultModelListed: ids.includes(defaultModel),
      error: null,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const failed = (status: number | null, kind: LlmEndpointErrorKind, message: string, code?: string): LlmEndpointTestResult => ({
      ...base,
      ok: false,
      status,
      latencyMs,
      modelCount: null,
      defaultModelListed: null,
      error: { kind, message, ...(code ? { code } : {}) },
    });
    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      return failed(null, 'timeout', `Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} s.`);
    }
    if (err instanceof OpenAI.APIConnectionError) {
      const code = networkCode(err);
      return failed(null, 'network', 'Verbindung fehlgeschlagen — Adresse, DNS, Firewall/Proxy und TLS-Zertifikat prüfen.', code);
    }
    if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
      return failed(err.status ?? null, 'auth', 'Endpunkt erreichbar, aber der API-Key wurde abgelehnt.');
    }
    if (err instanceof OpenAI.NotFoundError) {
      return failed(404, 'not_found', 'Endpunkt erreichbar, aber /models nicht gefunden — fehlt in der Adresse z. B. „/v1“?');
    }
    if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
      return failed(err.status, 'http', `Endpunkt antwortet mit HTTP ${err.status}.`);
    }
    return failed(null, 'invalid_response', 'Antwort ist keine OpenAI-kompatible Modellliste.');
  }
}
