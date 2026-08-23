import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
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
const expectedSongIds = [
  'ay_soundcheck',
  'chaosbunny_escape',
  'korobeiniki',
  'nad_tatrou_sa_blyska',
  'ode_to_joy',
  'stereo_ambulance',
  'wilhelmus',
];

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

test('generated catalog contains exactly the seven current source songs', async () => {
  const catalog = JSON.parse(await readFile(path.join(songsDirectory, 'index.json'), 'utf8'));

  assert.deepEqual(
    catalog.songs.map((song) => song.id),
    expectedSongIds,
  );
  assert.ok(catalog.songs.every((song) => song.type === 'json' && song.file === `${song.id}.json`));
  assert.equal(
    catalog.songs.find((song) => song.id === 'stereo_ambulance').catalog.audio.chip,
    'procedural Web Audio effect',
  );
  assert.equal(
    catalog.songs.find((song) => song.id === 'ay_soundcheck').catalog.cover,
    '/assets/covers/ay_soundcheck/cover.png',
  );
});

test('every bundled JSON song contains a fully documented 2026 catalog record', async () => {
  const songFiles = (await readdir(songsDirectory)).filter(
    (file) => file.endsWith('.json') && file !== 'index.json' && !file.endsWith('.meta.json'),
  );

  assert.equal(songFiles.length, 7);
  const songIds = [];
  for (const file of songFiles) {
    const song = JSON.parse(await readFile(path.join(songsDirectory, file), 'utf8'));
    const catalog = normalizeCatalog(song.catalog, { type: 'json', effect: Boolean(song.effect) });
    songIds.push(song.id);

    assert.equal(catalog.releaseYear, 2026, `${file}: releaseYear`);
    assert.ok(catalog.originalDate, `${file}: originalDate`);
    const expectedCover = `/assets/covers/${song.id}/cover.png`;
    assert.equal(catalog.cover, expectedCover, `${file}: cover`);
    assert.equal(catalog.rightsStatus, 'documented', `${file}: rightsStatus`);
    if (song.id === 'stereo_ambulance') {
      assert.equal(catalog.audio.chip, 'procedural Web Audio effect', `${file}: procedural effect metadata`);
    }
    if (historicalSongIds.has(song.id)) {
      assert.equal(catalog.rights.composition.status, 'public-domain-eu', `${file}: composition status`);
      assert.ok(catalog.rights.composition.evidenceUrl, `${file}: historical evidence`);
      assert.match(catalog.rights.composition.legalBasisUrl, /^https:\/\/eur-lex\.europa\.eu\//, `${file}: EU basis`);
    }

    const coverDirectory = path.join(projectDirectory, 'assets', 'covers', song.id);
    const [native, preview, scrStats] = await Promise.all([
      readFile(path.join(coverDirectory, 'cover.png')),
      readFile(path.join(coverDirectory, 'cover-4x.png')),
      stat(path.join(coverDirectory, 'cover.scr')),
    ]);
    assert.deepEqual(readPngDimensions(native), { width: 256, height: 192 }, `${file}: native cover dimensions`);
    assert.deepEqual(readPngDimensions(preview), { width: 1024, height: 768 }, `${file}: preview cover dimensions`);
    assert.equal(scrStats.size, 6912, `${file}: SCR size`);
  }

  assert.deepEqual(songIds.sort(), expectedSongIds);
});

function readPngDimensions(bytes) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), 'cover must be a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
