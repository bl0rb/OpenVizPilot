import OpenAI from 'openai';
import type { AppConfig } from '../env';

/**
 * OpenAI-Client gegen den LiteLLM-Proxy.
 *
 * maxRetries: 0 — bei SSE-Streams würde ein SDK-internes Retry nach
 * Teilübertragung Duplikate erzeugen. Die Retry-Entscheidung trifft die
 * Extension anhand des `retryable`-Flags im error-Event.
 */
export function createLLMClient(config: AppConfig): OpenAI {
  return new OpenAI({
    baseURL: config.litellmBaseUrl,
    apiKey: config.litellmApiKey,
    timeout: 120_000,
    maxRetries: 0,
  });
}
