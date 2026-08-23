import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackClock } from '../scripts/playback-clock.js';

test('recomputes relative scheduler delays toward one audio-clock target', () => {
  const audio = { currentTime: 10 };
  const clock = createPlaybackClock(audio, 120);

  assert.equal(clock.audioStartTime, 10.12);
  assert.ok(Math.abs(clock.getStartDelayMs() - 120) < 1e-9);

  audio.currentTime = 10.075;
  assert.ok(Math.abs(clock.getStartDelayMs() - 45) < 1e-9);

  audio.currentTime = 10.2;
  assert.equal(clock.getStartDelayMs(), 0);
});

test('elapsed and remaining time stay anchored to a pausable audio clock', () => {
  const audio = { currentTime: 2 };
  const clock = createPlaybackClock(audio, 100);

  audio.currentTime = 2.04;
  assert.equal(clock.getElapsedMs(), 0);
  assert.equal(clock.getRemainingMs(31_080), 31_080);

  // Simulovaný suspend: wall time môže plynúť, ale audio currentTime zostane stáť.
  assert.equal(clock.getElapsedMs(), 0);
  assert.equal(clock.getRemainingMs(31_080), 31_080);

  audio.currentTime = 12.1;
  assert.ok(Math.abs(clock.getElapsedMs() - 10_000) < 1e-9);
  assert.ok(Math.abs(clock.getRemainingMs(31_080) - 21_080) < 1e-9);

  audio.currentTime = 33.5;
  assert.equal(clock.getRemainingMs(31_000), 0);
});

test('clamps invalid durations and rejects invalid clocks', () => {
  const audio = { currentTime: 1 };
  const clock = createPlaybackClock(audio, -20);
  assert.equal(clock.getStartDelayMs(), 0);
  assert.equal(clock.getRemainingMs(Number.NaN), 0);

  assert.throws(() => createPlaybackClock({ currentTime: Number.NaN }, 20), /currentTime/);
  assert.throws(() => createPlaybackClock(audio, Number.POSITIVE_INFINITY), /startDelayMs/);
});
