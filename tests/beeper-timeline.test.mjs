import assert from 'node:assert/strict';
import test from 'node:test';

import { createBeeperTimeline, getActiveBeeperEvent } from '../scripts/beeper-timeline.js';

const notes = [
  { freq: 440, dur: 100 },
  { freq: 0, dur: 50 },
  { freq: 660, dur: 200 },
];

test('creates tone events while preserving rests in following offsets', () => {
  assert.deepEqual(createBeeperTimeline(notes), [
    { freq: 440, dur: 100, index: 0, startMs: 0, endMs: 100 },
    { freq: 660, dur: 200, index: 2, startMs: 150, endMs: 350 },
  ]);
});

test('uses inclusive starts and exclusive ends at tone and rest boundaries', () => {
  const events = createBeeperTimeline(notes);

  assert.equal(getActiveBeeperEvent(events, -1), null);
  assert.equal(getActiveBeeperEvent(events, 100), null);
  assert.equal(getActiveBeeperEvent(events, 149.999), null);

  const atStart = getActiveBeeperEvent(events, 150);
  assert.equal(atStart.event.index, 2);
  assert.equal(atStart.remainingMs, 200);
});

test('returns the remaining half of a tone and silence at its exact end', () => {
  const events = createBeeperTimeline(notes);
  const halfway = getActiveBeeperEvent(events, 250);

  assert.equal(halfway.event.freq, 660);
  assert.equal(halfway.remainingMs, 100);
  assert.equal(getActiveBeeperEvent(events, 350), null);
});

test('can be queried again to resume only the remainder of an active tone', () => {
  const events = createBeeperTimeline(notes);
  const beforeMute = getActiveBeeperEvent(events, 175);
  const afterReenable = getActiveBeeperEvent(events, 275);

  assert.equal(beforeMute.event.index, 2);
  assert.equal(beforeMute.remainingMs, 175);
  assert.equal(afterReenable.event.index, 2);
  assert.equal(afterReenable.remainingMs, 75);
});
