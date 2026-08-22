import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANNEL_VOLUME_STORAGE_KEY,
  loadChannelVolumes,
  resetChannelVolumes,
  saveChannelVolumes,
} from '../scripts/channel-volume-store.js';

const DEFAULT_VOLUMES = { A: 1, B: 1, C: 1, BEEPER: 1 };

function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    value(key) {
      return entries.get(key);
    },
  };
}

test('loads 100% defaults without browser globals or saved data', () => {
  assert.equal(CHANNEL_VOLUME_STORAGE_KEY, 'zxplayer.channelVolumes.v1');
  assert.deepEqual(loadChannelVolumes(undefined, 'new-song'), DEFAULT_VOLUMES);
  assert.deepEqual(loadChannelVolumes(createStorage(), 'new-song'), DEFAULT_VOLUMES);
});

test('saves full normalized volumes independently for each song', () => {
  const storage = createStorage();

  assert.deepEqual(saveChannelVolumes(storage, 'song-a', { A: 0.25, C: 0, BEEPER: 0.8 }), {
    A: 0.25,
    B: 1,
    C: 0,
    BEEPER: 0.8,
  });
  saveChannelVolumes(storage, 'song-b', { B: 0.4 });

  assert.deepEqual(loadChannelVolumes(storage, 'song-a'), { A: 0.25, B: 1, C: 0, BEEPER: 0.8 });
  assert.deepEqual(loadChannelVolumes(storage, 'song-b'), { A: 1, B: 0.4, C: 1, BEEPER: 1 });
  assert.deepEqual(JSON.parse(storage.value(CHANNEL_VOLUME_STORAGE_KEY)), {
    'song-a': { A: 0.25, B: 1, C: 0, BEEPER: 0.8 },
    'song-b': { A: 1, B: 0.4, C: 1, BEEPER: 1 },
  });
});

test('invalid saved values fall back to 100%', () => {
  const storage = createStorage({
    [CHANNEL_VOLUME_STORAGE_KEY]: JSON.stringify({
      damaged: { A: '0.5', B: -0.1, C: 1.1, BEEPER: null },
      partial: { A: 0, C: 0.5 },
    }),
  });

  assert.deepEqual(loadChannelVolumes(storage, 'damaged'), DEFAULT_VOLUMES);
  assert.deepEqual(loadChannelVolumes(storage, 'partial'), { A: 0, B: 1, C: 0.5, BEEPER: 1 });

  const malformedStorage = createStorage({ [CHANNEL_VOLUME_STORAGE_KEY]: '{not valid JSON' });
  assert.deepEqual(loadChannelVolumes(malformedStorage, 'damaged'), DEFAULT_VOLUMES);
});

test('invalid updates are ignored while valid partial updates are saved', () => {
  const storage = createStorage();
  saveChannelVolumes(storage, 'song', { A: 0.2, B: 0.3, C: 0.4, BEEPER: 0.5 });

  const saved = saveChannelVolumes(storage, 'song', {
    A: Number.NaN,
    B: Number.POSITIVE_INFINITY,
    C: -1,
    BEEPER: 0.75,
  });

  assert.deepEqual(saved, { A: 0.2, B: 0.3, C: 0.4, BEEPER: 0.75 });
  assert.deepEqual(loadChannelVolumes(storage, 'song'), saved);
});

test('reset removes only the selected song and restores its defaults', () => {
  const storage = createStorage();
  saveChannelVolumes(storage, 'song-a', { A: 0.2 });
  saveChannelVolumes(storage, 'song-b', { B: 0.3 });

  assert.deepEqual(resetChannelVolumes(storage, 'song-a'), DEFAULT_VOLUMES);
  assert.deepEqual(loadChannelVolumes(storage, 'song-a'), DEFAULT_VOLUMES);
  assert.deepEqual(loadChannelVolumes(storage, 'song-b'), { A: 1, B: 0.3, C: 1, BEEPER: 1 });
  assert.deepEqual(Object.keys(JSON.parse(storage.value(CHANNEL_VOLUME_STORAGE_KEY))), ['song-b']);
});

test('storage access failures never break volume state handling', () => {
  const unavailableStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  assert.deepEqual(loadChannelVolumes(unavailableStorage, 'song'), DEFAULT_VOLUMES);
  assert.deepEqual(saveChannelVolumes(unavailableStorage, 'song', { A: 0.5 }), {
    A: 0.5,
    B: 1,
    C: 1,
    BEEPER: 1,
  });
  assert.deepEqual(resetChannelVolumes(unavailableStorage, 'song'), DEFAULT_VOLUMES);
});
