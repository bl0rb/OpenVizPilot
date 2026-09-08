import { defineConfig } from 'tsup';
import { copyFile } from 'node:fs/promises';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  // Explizites Node-Target: sonst strippt esbuild das "node:"-Präfix
  // (node:sqlite würde zum unauflösbaren Paket "sqlite").
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  onSuccess: async () => {
    await copyFile(new URL('./scripts/INTER-LICENSE.txt', import.meta.url), new URL('./dist/INTER-LICENSE.txt', import.meta.url));
  },
  // Alles mitbündeln → das Docker-Runtime-Image braucht keine node_modules.
  noExternal: [/.*/],
  // pg-native: optionale native Erweiterung von pg — wird nie geladen.
  // node:sqlite: neueres Node-Builtin, das esbuild sonst fälschlich zu
  // "sqlite" umschreibt — explizit external lassen.
  external: ['pg-native', 'node:sqlite'],
  banner: {
    // CommonJS-Dependencies (pg) nutzen require() für Node-Builtins — im
    // ESM-Bundle muss require dafür bereitgestellt werden.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
