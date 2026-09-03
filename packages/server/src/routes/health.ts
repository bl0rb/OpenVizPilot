import { Hono } from 'hono';

/** Liveness ohne LiteLLM-Abhängigkeit. */
export function createHealthRoute(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}
