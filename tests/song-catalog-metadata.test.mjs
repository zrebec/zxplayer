import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_COVER,
  deriveRightsStatus,
  isSupportedSongFile,
  metadataSidecarCandidates,
  normalizeCatalog,
} from '../scripts/song-catalog-metadata.js';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const songsDirectory = path.join(projectDirectory, 'songs');
const historicalSongIds = new Set(['korobeiniki', 'nad_tatrou_sa_blyska', 'ode_to_joy', 'wilhelmus']);

test('missing catalog metadata gets safe audio, cover, and rights fallbacks', () => {
  const catalog = normalizeCatalog(undefined, { type: 'psg', machine: 'atariST' });

  assert.equal(catalog.releaseYear, null);
  assert.equal(catalog.originalDate, null);
  assert.equal(catalog.cover, DEFAULT_COVER);
  assert.deepEqual(catalog.audio, {
    sourceFormat: 'psg-register-dump',
    runtimeFormat: 'audio-worklet',
    chip: 'YM2149',
  });
  assert.equal(catalog.rightsStatus, 'unverified');
  assert.deepEqual(Object.keys(catalog.rights), ['composition', 'arrangement', 'source', 'cover']);
  assert.ok(Object.values(catalog.rights).every((entry) => entry.status === 'unverified'));
});

test('rights are documented only when every category contains appropriate evidence', () => {
  const rights = {
    composition: {
      status: 'public-domain-eu',
      label: 'Historical composition; treated as public domain in the EU.',
      evidenceUrl: 'https://example.com/evidence',
    },
    arrangement: { status: 'all-rights-reserved', label: 'Protected arrangement.', holder: 'Fox' },
    source: { status: 'all-rights-reserved', label: 'Protected source.', holder: 'Fox' },
    cover: { status: 'all-rights-reserved', label: 'Protected cover.', holder: 'Fox' },
  };

  assert.equal(deriveRightsStatus(rights), 'documented');
  assert.equal(
    deriveRightsStatus({ ...rights, composition: { ...rights.composition, evidenceUrl: '' } }),
    'unverified',
  );
  assert.equal(deriveRightsStatus({ ...rights, cover: { ...rights.cover, holder: '' } }), 'unverified');
  assert.equal(
    normalizeCatalog({ rights: { ...rights, cover: { ...rights.cover, label: '' } } }).rightsStatus,
    'unverified',
  );
});

test('JSON effects receive a distinct source format without overriding authored values', () => {
  const effectCatalog = normalizeCatalog({}, { type: 'json', effect: true });
  const authoredCatalog = normalizeCatalog(
    {
      audio: { sourceFormat: 'custom-json', runtimeFormat: 'custom-runtime', chip: 'Custom chip' },
    },
    { type: 'json', effect: true },
  );

  assert.equal(effectCatalog.audio.sourceFormat, 'json-effect');
  assert.deepEqual(authoredCatalog.audio, {
    sourceFormat: 'custom-json',
    runtimeFormat: 'custom-runtime',
    chip: 'Custom chip',
  });
});

test('PSG metadata sidecars are excluded from the playable song list', () => {
  assert.equal(isSupportedSongFile('demo.psg'), true);
  assert.equal(isSupportedSongFile('demo.json'), true);
  assert.equal(isSupportedSongFile('demo.psg.meta.json'), false);
  assert.equal(isSupportedSongFile('demo.meta.json'), false);
  assert.equal(isSupportedSongFile('index.json'), false);
  assert.deepEqual(metadataSidecarCandidates('generated/demo.psg'), [
    'generated/demo.psg.meta.json',
    'generated/demo.meta.json',
  ]);
});

test('every bundled JSON song contains a fully documented 2026 catalog record', async () => {
  const songFiles = (await readdir(songsDirectory)).filter(
    (file) => file.endsWith('.json') && file !== 'index.json' && !file.endsWith('.meta.json'),
  );

  assert.equal(songFiles.length, 10);
  for (const file of songFiles) {
    const song = JSON.parse(await readFile(path.join(songsDirectory, file), 'utf8'));
    const catalog = normalizeCatalog(song.catalog, { type: 'json', effect: Boolean(song.effect) });

    assert.equal(catalog.releaseYear, 2026, `${file}: releaseYear`);
    assert.ok(catalog.originalDate, `${file}: originalDate`);
    const expectedCover = song.id === 'channel_duration_test' ? DEFAULT_COVER : `/assets/covers/${song.id}/cover.png`;
    assert.equal(catalog.cover, expectedCover, `${file}: cover`);
    assert.equal(catalog.rightsStatus, 'documented', `${file}: rightsStatus`);
    if (historicalSongIds.has(song.id)) {
      assert.equal(catalog.rights.composition.status, 'public-domain-eu', `${file}: composition status`);
      assert.ok(catalog.rights.composition.evidenceUrl, `${file}: historical evidence`);
      assert.match(catalog.rights.composition.legalBasisUrl, /^https:\/\/eur-lex\.europa\.eu\//, `${file}: EU basis`);
    }
  }
});
