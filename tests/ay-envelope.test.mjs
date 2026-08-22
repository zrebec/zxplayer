import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeAYEnvelopeShape, scheduleAYEnvelope } from '../scripts/ay-envelope.js';

const LOW = 0.0001;
const HIGH = 0.28;

function createRecordingAudioParam() {
  const calls = [];
  return {
    calls,
    cancelScheduledValues(time) {
      calls.push(['cancel', time]);
    },
    setValueAtTime(value, time) {
      calls.push(['set', value, time]);
    },
    linearRampToValueAtTime(value, time) {
      calls.push(['ramp', value, time]);
    },
  };
}

function schedule(shape, cycleCount = 2) {
  const audioParam = createRecordingAudioParam();
  scheduleAYEnvelope(audioParam, shape, 0.025, 2, cycleCount);
  return audioParam.calls;
}

test('decodes all R13 envelope-control bits directly from the numeric shape', () => {
  for (let shape = 0; shape <= 15; shape += 1) {
    assert.deepEqual(decodeAYEnvelopeShape(shape), {
      CONT: (shape >> 3) & 1,
      ATT: (shape >> 2) & 1,
      ALT: (shape >> 1) & 1,
      HOLD: shape & 1,
    });
  }
});

test('shape 13 attacks once and holds high for the rest of the note', () => {
  assert.deepEqual(schedule(13), [
    ['cancel', 2],
    ['set', LOW, 2],
    ['ramp', HIGH, 2.025],
    ['set', HIGH, 2.025],
  ]);
});

test('non-continuing shapes ignore ALT and HOLD and always finish low', () => {
  for (const shape of [0, 1, 2, 3]) {
    assert.deepEqual(schedule(shape), [
      ['cancel', 2],
      ['set', HIGH, 2],
      ['ramp', LOW, 2.025],
      ['set', LOW, 2.025],
    ]);
  }

  for (const shape of [4, 5, 6, 7]) {
    assert.deepEqual(schedule(shape), [
      ['cancel', 2],
      ['set', LOW, 2],
      ['ramp', HIGH, 2.025],
      ['set', LOW, 2.025],
    ]);
  }
});

test('continuing HOLD shapes stop at the AY-defined final level', () => {
  const expectedHoldGain = new Map([
    [9, LOW],
    [11, HIGH],
    [13, HIGH],
    [15, LOW],
  ]);

  for (const [shape, holdGain] of expectedHoldGain) {
    assert.equal(schedule(shape).at(-1)[1], holdGain);
  }
});

test('repeating shapes preserve sawtooth and alternating ramp directions', () => {
  const rampDirections = (shape) =>
    schedule(shape)
      .filter(([method]) => method !== 'cancel')
      .map(([, value]) => value);

  assert.deepEqual(rampDirections(8), [HIGH, LOW, HIGH, LOW]);
  assert.deepEqual(rampDirections(10), [HIGH, LOW, LOW, HIGH]);
  assert.deepEqual(rampDirections(12), [LOW, HIGH, LOW, HIGH]);
  assert.deepEqual(rampDirections(14), [LOW, HIGH, HIGH, LOW]);
});

test('rejects invalid envelope scheduling inputs', () => {
  const audioParam = createRecordingAudioParam();

  assert.throws(() => decodeAYEnvelopeShape(16), /0 to 15/);
  assert.throws(() => scheduleAYEnvelope(audioParam, 13, 0, 0, 1), /cycleDurationSeconds/);
  assert.throws(() => scheduleAYEnvelope(audioParam, 13, 0.1, -1, 1), /startTimeSeconds/);
  assert.throws(() => scheduleAYEnvelope(audioParam, 13, 0.1, 0, 0), /cycleCount/);
});
