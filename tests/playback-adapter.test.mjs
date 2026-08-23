import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackAdapter } from '../scripts/playback-adapter.js';

test('routes AY and Beeper controls to their upstream handles', () => {
  const calls = [];
  const ayHandle = {
    setChannelGain: (...args) => calls.push(['ay-gain', ...args]),
    setStereoMode: (...args) => calls.push(['ay-stereo', ...args]),
    stop: () => calls.push(['ay-stop']),
  };
  const beeperHandle = {
    setGain: (...args) => calls.push(['beeper-gain', ...args]),
    stop: () => calls.push(['beeper-stop']),
  };
  const playback = createPlaybackAdapter({ ayHandle, beeperHandle });

  playback.setChannelGain('A', 0.25, 12);
  playback.setChannelGain('C', 0.75);
  playback.setChannelGain('BEEPER', 0.4, 8);
  playback.setStereoMode('abc');
  playback.stop();
  playback.stop();

  assert.deepEqual(calls, [
    ['ay-gain', 'A', 0.25, 12],
    ['ay-gain', 'C', 0.75, undefined],
    ['beeper-gain', 0.4, 8],
    ['ay-stereo', 'abc'],
    ['ay-stop'],
    ['beeper-stop'],
  ]);
});

test('routes PSG channel gains and stereo through the AY dump handle API', () => {
  const calls = [];
  const psgHandle = {
    setChannelGain: (...args) => calls.push(['gain', ...args]),
    setStereo: (...args) => calls.push(['stereo', ...args]),
    stop: () => calls.push(['stop']),
  };
  const playback = createPlaybackAdapter({ psgHandle });

  playback.setChannelGain('B', 0, 5);
  playback.setStereoMode('mono');
  playback.setChannelGain('BEEPER', 0.5);
  playback.setChannelGain('UNKNOWN', 0.5);
  playback.stop();

  assert.deepEqual(calls, [['gain', 'B', 0, 5], ['stereo', 'mono'], ['stop']]);
});

test('routes Sanitka channels to its local effect handle', () => {
  const calls = [];
  const effectHandle = {
    setChannelGain: (...args) => calls.push(['gain', ...args]),
    stop: () => calls.push(['stop']),
  };
  const playback = createPlaybackAdapter({ effectHandle });

  playback.setChannelGain('A', 0.2, 20);
  playback.setChannelGain('B', 0.3);
  playback.setChannelGain('C', 0.4, 0);
  playback.setStereoMode('acb');
  playback.stop();

  assert.deepEqual(calls, [['gain', 'A', 0.2, 20], ['gain', 'B', 0.3, undefined], ['gain', 'C', 0.4, 0], ['stop']]);
});

test('rejects ambiguous primary handles and makes stopped adapters inert', () => {
  const handle = {
    setChannelGain() {},
    setStereoMode() {},
    setStereo() {},
    stop() {},
  };

  assert.throws(
    () => createPlaybackAdapter({ ayHandle: handle, psgHandle: handle }),
    /expected only one AY, PSG, or effect handle/,
  );

  let calls = 0;
  const playback = createPlaybackAdapter({
    ayHandle: {
      setChannelGain: () => {
        calls += 1;
      },
      setStereoMode: () => {
        calls += 1;
      },
      stop: () => {
        calls += 1;
      },
    },
  });

  playback.stop();
  playback.setChannelGain('A', 1);
  playback.setStereoMode('abc');
  playback.stop();
  assert.equal(calls, 1);
});

test('stops every distinct owned handle even when one stop throws', () => {
  const error = new Error('AY stop failed');
  let beeperStops = 0;
  const playback = createPlaybackAdapter({
    ayHandle: {
      setChannelGain() {},
      setStereoMode() {},
      stop: () => {
        throw error;
      },
    },
    beeperHandle: {
      setGain() {},
      stop: () => {
        beeperStops += 1;
      },
    },
  });

  assert.throws(() => playback.stop(), error);
  assert.equal(beeperStops, 1);
  assert.doesNotThrow(() => playback.stop());
  assert.equal(beeperStops, 1);
});
