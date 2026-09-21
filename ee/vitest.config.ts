import { defineConfig } from 'vitest/config';

// Der Stub hat keine eigenen Tests (ee/test/ gehört nur zum privaten Baum,
// siehe scripts/core-export.sh) — diese Datei muss trotzdem existieren, weil
// die Root-vitest.config.ts sie als Projekt referenziert.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
