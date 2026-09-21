import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FALLBACK_COVER, resolveCoverUrl } from '../scripts/cover-url.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = 'https://zrebec.github.io/zxplayer/';

test('a catalogue path resolves under the subdirectory the page is served from', () => {
  assert.equal(
    resolveCoverUrl('assets/covers/arctic_circuit/cover.png', PAGES),
    'https://zrebec.github.io/zxplayer/assets/covers/arctic_circuit/cover.png',
  );
  assert.equal(
    resolveCoverUrl('assets/covers/x/cover.png', 'http://localhost:8931/'),
    'http://localhost:8931/assets/covers/x/cover.png',
  );
});

test('a leading slash is stripped instead of asking the domain root', () => {
  // The bug this module exists for: `/assets/...` resolved to zrebec.github.io/assets/...,
  // which is a 404, and every cover in the library came up blank.
  assert.equal(
    resolveCoverUrl('/assets/covers/blue_danube/cover.png', PAGES),
    'https://zrebec.github.io/zxplayer/assets/covers/blue_danube/cover.png',
  );
  assert.equal(resolveCoverUrl('///assets/covers/x/cover.png', PAGES), `${PAGES}assets/covers/x/cover.png`);
});

test('absolute URLs are passed through untouched', () => {
  for (const url of ['https://example.test/cover.png', 'data:image/png;base64,AAAA', '//example.test/cover.png']) {
    assert.equal(resolveCoverUrl(url, PAGES), url);
  }
});

test('a missing, blank or non-string path falls back to the fallback cover', () => {
  const expected = `${PAGES}${FALLBACK_COVER}`;
  for (const value of [undefined, null, '', '   ', 42, {}]) {
    assert.equal(resolveCoverUrl(value, PAGES), expected);
  }
});

test('every catalogue cover is relative, so the site survives being served from a subdirectory', async () => {
  const songsDir = path.join(root, 'songs');
  const files = (await readdir(songsDir)).filter((file) => file.endsWith('.json') && file !== 'index.json');
  assert.ok(files.length > 0, 'expected song sources to exist');

  for (const file of files) {
    const song = JSON.parse(await readFile(path.join(songsDir, file), 'utf8'));
    const cover = song?.catalog?.cover;
    if (cover === undefined) continue;
    assert.ok(
      !cover.startsWith('/'),
      `${file}: cover "${cover}" starts with "/" — it would ask the domain root and 404 on GitHub Pages`,
    );
  }
});

test('the generated catalogue carries the same relative paths', async () => {
  const catalogue = JSON.parse(await readFile(path.join(root, 'songs', 'index.json'), 'utf8'));
  const songs = Array.isArray(catalogue) ? catalogue : (catalogue.songs ?? []);
  assert.ok(songs.length > 0, 'expected a generated catalogue');

  for (const song of songs) {
    const cover = song?.catalog?.cover;
    if (cover === undefined) continue;
    assert.ok(!cover.startsWith('/'), `${song.id}: generated cover "${cover}" starts with "/"`);
  }
});
