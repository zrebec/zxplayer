/**
 * Assembles the deployable site into `_site/`.
 *
 * The player has no bundler and needs none: every browser module is served as it is
 * written, and `zx-kit` arrives from the CDN through `scripts/zx-kit.js`. So a "build"
 * here is a copy with a list — which is exactly why the list lives in a script instead
 * of in the workflow. Running `npm run site` locally produces the same directory
 * GitHub Pages will serve, so a broken deploy can be reproduced without pushing.
 *
 * Run `npm run build` first: the catalogue (`songs/index.json`) and any PSG dumps
 * converted from PT3 sources are generated, not authored, and this script only copies.
 */
import { cp, mkdir, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');

/** Everything the served page reaches for: the two pages, their styles, modules and data. */
const CONTENT = ['index.html', 'sprite.html', 'style.css', 'scripts', 'songs', 'assets'];

/**
 * Cover concept sources are local-only (.gitignore), so a CI checkout has none. Skipping
 * them here too keeps a local `_site` byte-comparable with the deployed one.
 */
const EXCLUDE = new Set(['concept.png']);

/** Files the site is broken without — cheaper to fail here than to deploy a blank page. */
const REQUIRED = ['index.html', 'style.css', 'scripts/player.js', 'scripts/zx-kit.js', 'songs/index.json'];

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const entry of CONTENT) {
    await cp(path.join(root, entry), path.join(out, entry), {
      recursive: true,
      filter: (source) => !EXCLUDE.has(path.basename(source)),
    });
  }

  for (const entry of REQUIRED) {
    const target = path.join(out, entry);
    const found = await stat(target).catch(() => null);
    if (!found?.isFile()) throw new Error(`_site/${entry} is missing — the site would not load`);
  }

  const catalogue = JSON.parse(await readFile(path.join(out, 'songs', 'index.json'), 'utf8'));
  const songs = Array.isArray(catalogue) ? catalogue : (catalogue.songs ?? []);
  if (songs.length === 0) throw new Error('_site/songs/index.json holds no songs — run `npm run build` first');

  console.log(`Site assembled in _site/: ${songs.length} skladba(y).`);
}

await main();
