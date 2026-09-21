import assert from 'node:assert/strict';
import test from 'node:test';

import { describeLibraryCount, filterSongLibrary } from '../scripts/song-library-filter.js';

const songs = [
  {
    id: 'frere_jacques',
    title: 'Frère Jacques',
    artist: 'Traditional French round',
    catalog: { audio: { chip: 'AY-3-8910 (ABC stereo)' } },
  },
  {
    id: 'midnight_power_play',
    title: 'Midnight Power Play',
    artist: 'Fox',
    catalog: { audio: { chip: 'AY-3-8910 (ACB stereo) + 1-bit Beeper' } },
  },
  {
    id: 'nad_tatrou_sa_blyska',
    title: 'Nad Tatrou sa blýska',
    artist: 'Traditional Slovak anthem',
    catalog: { audio: { chip: 'AY-3-8910' } },
  },
];

test('blank filtering preserves the full library without returning its original array', () => {
  const result = filterSongLibrary(songs, '   ');

  assert.deepEqual(result, songs);
  assert.notEqual(result, songs);
});

test('filtering is case- and diacritic-insensitive across title, artist, id, and chip', () => {
  assert.deepEqual(
    filterSongLibrary(songs, 'FRERE').map(({ id }) => id),
    ['frere_jacques'],
  );
  assert.deepEqual(
    filterSongLibrary(songs, 'blySKA').map(({ id }) => id),
    ['nad_tatrou_sa_blyska'],
  );
  assert.deepEqual(
    filterSongLibrary(songs, 'power_play').map(({ id }) => id),
    ['midnight_power_play'],
  );
  assert.deepEqual(
    filterSongLibrary(songs, 'beeper').map(({ id }) => id),
    ['midnight_power_play'],
  );
  assert.deepEqual(
    filterSongLibrary(songs, 'fox beeper').map(({ id }) => id),
    ['midnight_power_play'],
  );
});

test('missing song fields and non-string queries are handled safely', () => {
  assert.deepEqual(filterSongLibrary([{}, { title: 'Signal' }], 'signal'), [{ title: 'Signal' }]);
  assert.deepEqual(filterSongLibrary(songs, null), songs);
});

test('library counts distinguish complete, filtered, and empty views', () => {
  assert.equal(describeLibraryCount(23, 23), '23 TRACKS');
  assert.equal(describeLibraryCount(4, 23), '4 / 23 TRACKS');
  assert.equal(describeLibraryCount(0, 23), 'NO TRACKS');
});
