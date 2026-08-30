/**
 * Bundles the data-layer tests and runs them.
 *
 * esbuild is needed for three things Node cannot do on its own here: the `@/*`
 * path alias, importing `.sql` migrations as text, and swapping `expo-sqlite`
 * for the Node shim. The entry has to sit inside the project so esbuild
 * resolves `node_modules`; the output goes under `node_modules/.cache`, which
 * is already ignored by git.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outfile = resolve(root, 'node_modules/.cache/flashcards-tests.mjs');

await build({
  entryPoints: [resolve(here, 'data-layer.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: {
    'expo-sqlite': resolve(here, 'expo-sqlite-shim.mjs'),
    '@': resolve(root, 'src'),
  },
  loader: { '.sql': 'text' },
  logLevel: 'warning',
});

await import(`file://${outfile}`);
