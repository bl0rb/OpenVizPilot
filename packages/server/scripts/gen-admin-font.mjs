import { readFile, writeFile } from 'node:fs/promises';

const fontUrl = new URL(import.meta.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
const font = await readFile(fontUrl);
await writeFile(new URL('../src/admin-font.ts', import.meta.url), `export const adminFont = 'data:font/woff2;base64,${font.toString('base64')}';\n`);