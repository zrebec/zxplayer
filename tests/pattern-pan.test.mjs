import assert from 'node:assert/strict';
import test from 'node:test';

import { materializePatternPan, resolveChannelDefaultPan } from '../scripts/pattern-pan.js';

test('prefers song-authored channel pan and otherwise uses the playback stereo preset', () => {
  assert.equal(resolveChannelDefaultPan(-0.25, 0.6), -0.25);
  assert.equal(resolveChannelDefaultPan(undefined, 0.6), 0.6);
});

test('materializes the effective default pan at an unpositioned pattern boundary', () => {
  const notes = [{ freq: 440, dur: 1000 }];
  const positioned = materializePatternPan({ notes, duration: 1000 }, 0.6);

  assert.deepEqual(positioned, {
    notes: [{ freq: 440, dur: 1000, pan: 0.6 }],
    pan: 0.6,
    sweep: null,
  });
  assert.deepEqual(notes, [{ freq: 440, dur: 1000 }]);
});

test('sets static pattern pan at the start without mutating source notes', () => {
  const notes = [
    { freq: 0, dur: 500 },
    { freq: 440, dur: 500 },
  ];
  const positioned = materializePatternPan({ notes, duration: 1000, pan: -1 }, 0.6);

  assert.deepEqual(positioned, {
    notes: [
      { freq: 0, dur: 500, pan: -1 },
      { freq: 440, dur: 500 },
    ],
    pan: -1,
    sweep: null,
  });
  assert.deepEqual(notes, [
    { freq: 0, dur: 500 },
    { freq: 440, dur: 500 },
  ]);
});

test('interpolates a continuous authored sweep across unequal note durations', () => {
  const notes = [
    { freq: 440, dur: 250 },
    { freq: 440, dur: 750 },
  ];
  const sweep = { from: -1, to: 1 };
  const positioned = materializePatternPan({ notes, duration: 1000, sweep }, 0.6);

  assert.deepEqual(positioned, {
    notes: [
      { freq: 440, dur: 250, pan: -1, panTo: -0.5 },
      { freq: 440, dur: 750, pan: -0.5, panTo: 1 },
    ],
    pan: undefined,
    sweep,
  });
});

test('resets a static authored pan when the following pattern is unpositioned', () => {
  const panned = materializePatternPan({ notes: [{ freq: 440, dur: 500 }], duration: 500, pan: -1 }, 0.6);
  const unpositioned = materializePatternPan({ notes: [{ freq: 660, dur: 500 }], duration: 500 }, 0.6);

  assert.equal(panned.notes[0].pan, -1);
  assert.equal(unpositioned.notes[0].pan, 0.6);
  assert.equal(unpositioned.pan, 0.6);
  assert.equal(unpositioned.sweep, null);
});

test('resets the endpoint of an authored sweep when the following pattern is unpositioned', () => {
  const swept = materializePatternPan(
    { notes: [{ freq: 440, dur: 500 }], duration: 500, sweep: { from: -1, to: 1 } },
    -0.4,
  );
  const unpositioned = materializePatternPan({ notes: [{ freq: 660, dur: 500 }], duration: 500 }, -0.4);

  assert.equal(swept.notes.at(-1).panTo, 1);
  assert.equal(unpositioned.notes[0].pan, -0.4);
  assert.equal(unpositioned.pan, -0.4);
  assert.equal(unpositioned.sweep, null);
});
