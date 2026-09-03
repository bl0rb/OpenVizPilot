import preact from '@preact/preset-vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Proxy-Ziel folgt dem PORT der Middleware aus der Root-.env (Default 3000).
function serverPort(): string {
  try {
    const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
    const match = /^PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(envFile, 'utf8'));
    if (match?.[1]) return match[1];
  } catch {
    // keine .env — Default verwenden
  }
  return process.env.PORT ?? '3000';
}

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Dev: Same-Origin über den Vite-Proxy — kein CORS nötig.
      '/api': `http://localhost:${serverPort()}`,
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
});
