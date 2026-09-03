import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadDotEnv, loadEnv } from './env';

loadDotEnv();

let config;
try {
  config = loadEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const { app, logger } = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(`Middleware läuft auf http://localhost:${info.port}`, {
    litellm: config.litellmBaseUrl,
    defaultModel: config.defaultModel,
    staticDir: config.serveStaticDir ?? undefined,
  });
});
