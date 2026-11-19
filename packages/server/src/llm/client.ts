import OpenAI from 'openai';
import type { AppConfig } from '../env';

/** Zeitlimit je LLM-Aufruf im Betrieb — in der Admin-UI angezeigt. */
export const LLM_TIMEOUT_MS = 120_000;

/**
 * OpenAI-Client gegen den LiteLLM-Proxy.
 *
 * maxRetries: 0 — bei SSE-Streams würde ein SDK-internes Retry nach
 * Teilübertragung Duplikate erzeugen. Die Retry-Entscheidung trifft die
 * Extension anhand des `retryable`-Flags im error-Event.
 */
export function createLLMClient(config: Pick<AppConfig, 'litellmBaseUrl' | 'litellmApiKey'>, timeout = LLM_TIMEOUT_MS): OpenAI {
  return new OpenAI({
    baseURL: config.litellmBaseUrl,
    apiKey: config.litellmApiKey,
    timeout,
    maxRetries: 0,
  });
}
