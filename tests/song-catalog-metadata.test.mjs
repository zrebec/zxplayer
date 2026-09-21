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
const newOriginalSongIds = new Set([
  'arctic_circuit',
  'bitshift_boulevard',
  'neon_warren',
  'one_bit_night_shift',
  'orbital_foundry',
  'signal_over_tatras',
  'midnight_power_play',
  'tilebound_rabbit',
]);
const newHistoricalSongIds = new Set([
  'blue_danube',
  'brahms_lullaby',
  'frere_jacques',
  'greensleeves',
  'hall_of_mountain_king',
  'infernal_galop',
  'minuet_in_g',
  'turkish_march',
]);
const historicalSongIds = new Set([
  'korobeiniki',
  'nad_tatrou_sa_blyska',
  'ode_to_joy',
  'wilhelmus',
  ...newHistoricalSongIds,
]);
const expectedSongIds = [
  'arctic_circuit',
  'ay_soundcheck',
  'bitshift_boulevard',
  'blue_danube',
  'brahms_lullaby',
  'chaosbunny_escape',
  'frere_jacques',
  'greensleeves',
  'hall_of_mountain_king',
  'infernal_galop',
  'korobeiniki',
  'midnight_power_play',
  'minuet_in_g',
  'nad_tatrou_sa_blyska',
  'neon_warren',
  'ode_to_joy',
  'one_bit_night_shift',
  'orbital_foundry',
  'signal_over_tatras',
  'stereo_ambulance',
  'tilebound_rabbit',
  'turkish_march',
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
  const songCatalog = normalizeCatalog({}, { type: 'json' });
  const authoredCatalog = normalizeCatalog(
    {
      audio: { sourceFormat: 'custom-json', runtimeFormat: 'custom-runtime', chip: 'Custom chip' },
    },
    { type: 'json', effect: true },
  );

  assert.equal(effectCatalog.audio.sourceFormat, 'json-effect');
  assert.equal(effectCatalog.audio.runtimeFormat, 'web-audio');
  assert.equal(effectCatalog.audio.chip, 'procedural Web Audio effect');
  assert.equal(songCatalog.audio.runtimeFormat, 'zx-kit-playback');
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

test('generated catalog contains the complete twenty-three-song source library', async () => {
  const catalog = JSON.parse(await readFile(path.join(songsDirectory, 'index.json'), 'utf8'));

  assert.deepEqual(catalog.songs.map((song) => song.id).sort(), expectedSongIds.toSorted());
  assert.ok(catalog.songs.every((song) => song.type === 'json' && song.file === `${song.id}.json`));
  assert.equal(
    catalog.songs.find((song) => song.id === 'stereo_ambulance').catalog.audio.chip,
    'procedural Web Audio effect',
  );
  // Relative, not root-absolute: the page is served from a subdirectory on GitHub Pages
  // (`/zxplayer/`), where a leading slash asks the domain root and 404s (`cover-url.js`).
  assert.equal(
    catalog.songs.find((song) => song.id === 'ay_soundcheck').catalog.cover,
    'assets/covers/ay_soundcheck/cover.png',
  );
});

test('every bundled JSON song contains release, source, rights, and cover metadata', async () => {
  const songFiles = (await readdir(songsDirectory)).filter(
    (file) => file.endsWith('.json') && file !== 'index.json' && !file.endsWith('.meta.json'),
  );

  assert.equal(songFiles.length, 23);
  const songIds = [];
  for (const file of songFiles) {
    const song = JSON.parse(await readFile(path.join(songsDirectory, file), 'utf8'));
    const catalog = normalizeCatalog(song.catalog, { type: 'json', effect: Boolean(song.effect) });
    songIds.push(song.id);

    assert.equal(catalog.releaseYear, 2026, `${file}: releaseYear`);
    assert.ok(catalog.originalDate, `${file}: originalDate`);
    const expectedCover = `assets/covers/${song.id}/cover.png`;
    assert.equal(catalog.cover, expectedCover, `${file}: cover`);
    assert.equal(catalog.rightsStatus, 'documented', `${file}: rightsStatus`);
    assert.ok(catalog.rights.source.label, `${file}: source label`);
    assert.notEqual(catalog.rights.source.status, 'unverified', `${file}: source status`);
    if (song.id === 'stereo_ambulance') {
      assert.equal(catalog.audio.chip, 'procedural Web Audio effect', `${file}: procedural effect metadata`);
      assert.equal(catalog.audio.runtimeFormat, 'web-audio', `${file}: procedural runtime`);
    } else {
      assert.equal(catalog.audio.runtimeFormat, 'zx-kit-playback', `${file}: zx-kit runtime`);
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

test('new songs cover original and historical music across ABC, ACB, Beeper, and combined mixes', async () => {
  const songs = new Map();
  for (const id of [...newOriginalSongIds, ...newHistoricalSongIds]) {
    songs.set(id, JSON.parse(await readFile(path.join(songsDirectory, `${id}.json`), 'utf8')));
  }

  assert.equal(songs.size, 16);
  for (const id of newOriginalSongIds) {
    assert.equal(songs.get(id).catalog.rights.composition.status, 'all-rights-reserved', `${id}: original`);
  }
  for (const id of newHistoricalSongIds) {
    assert.equal(songs.get(id).catalog.rights.composition.status, 'public-domain-eu', `${id}: historical`);
  }

  const abc = { A: -0.75, B: 0, C: 0.75 };
  const acb = { A: -0.75, B: 0.75, C: 0 };
  for (const id of [
    'bitshift_boulevard',
    'blue_danube',
    'brahms_lullaby',
    'frere_jacques',
    'infernal_galop',
    'neon_warren',
    'tilebound_rabbit',
  ]) {
    assert.deepEqual(songs.get(id).ay.pan, abc, `${id}: ABC layout`);
  }
  for (const id of [
    'arctic_circuit',
    'greensleeves',
    'hall_of_mountain_king',
    'midnight_power_play',
    'minuet_in_g',
    'orbital_foundry',
    'signal_over_tatras',
    'turkish_march',
  ]) {
    assert.deepEqual(songs.get(id).ay.pan, acb, `${id}: ACB layout`);
  }

  for (const id of [
    'arctic_circuit',
    'greensleeves',
    'hall_of_mountain_king',
    'infernal_galop',
    'midnight_power_play',
    'neon_warren',
    'one_bit_night_shift',
    'signal_over_tatras',
    'turkish_march',
  ]) {
    assert.ok(songs.get(id).beeper, `${id}: independent Beeper track`);
  }

  const beeperOnly = songs.get('one_bit_night_shift');
  assert.ok(Object.values(beeperOnly.channels).every(channelIsSilent), 'one_bit_night_shift: silent AY channels');
  assert.ok(channelHasTone(beeperOnly.beeper), 'one_bit_night_shift: audible Beeper track');
});

function channelIsSilent(channel) {
  return Object.values(channel.patterns).every((pattern) => {
    if (typeof pattern.notes === 'string') {
      return pattern.notes.split(/\s+/).every((token) => token === 'r' || token.startsWith('r:'));
    }
    return pattern.events.every((event) => event.note === 'r' || event.freq === 0);
  });
}

function channelHasTone(channel) {
  return Object.values(channel.patterns).some((pattern) => {
    if (typeof pattern.notes === 'string') {
      return pattern.notes.split(/\s+/).some((token) => token !== 'r' && !token.startsWith('r:'));
    }
    return pattern.events.some((event) => (typeof event.note === 'string' && event.note !== 'r') || event.freq > 0);
  });
}

function readPngDimensions(bytes) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), 'cover must be a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
