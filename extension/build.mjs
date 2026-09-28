// @ts-check
/**
 * Bundles the four entry points with esbuild and copies static assets into
 * dist/. Content scripts must be classic scripts, so everything is emitted as
 * an IIFE. `node build.mjs --watch` rebuilds on change.
 *
 * The extension imports only tokenizer/text/features from @tokenscore/core;
 * scoring and rating are never referenced, so they are not in the bundle.
 */
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist';
const options = {
  entryPoints: {
    content: 'src/content/index.js',
    background: 'src/background/index.js',
    popup: 'src/popup/popup.js',
    options: 'src/options/options.js',
  },
  bundle: true,
  format: /** @type {const} */ ('iife'),
  target: 'chrome120',
  minify: !process.argv.includes('--watch'),
  sourcemap: process.argv.includes('--watch'),
  outdir: out,
  logLevel: /** @type {const} */ ('info'),
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  cp('manifest.json', `${out}/manifest.json`),
  cp('src/popup/popup.html', `${out}/popup.html`),
  cp('src/options/options.html', `${out}/options.html`),
  cp('src/ui.css', `${out}/ui.css`),
]);

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
