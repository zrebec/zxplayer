import assert from 'node:assert/strict';
import test from 'node:test';
import { AYChipCore, AYDumpPlayer, AY_VOL } from 'zx-kit';

import { _buildChannelizedPSGWorkletSource, isolatePSGChannel } from '../scripts/psg-channel-player.js';

function makeDump() {
  return {
    frameRateHz: 50,
    frameCount: 2,
    writeRegs: Uint8Array.from([0, 8, 9, 10, 7, 8, 9, 10, 13]),
    writeVals: Uint8Array.from([23, 15, 14, 13, 56, 5, 6, 7, 10]),
    frameOffsets: Uint32Array.from([0, 5, 9]),
  };
}

function renderDump(dump) {
  const sampleRate = 8_000;
  const chip = new AYChipCore(sampleRate, 1_750_000, 16, AY_VOL, 'acb');
  const player = new AYDumpPlayer(
    chip,
    dump.writeRegs,
    dump.writeVals,
    dump.frameOffsets,
    dump.frameRateHz,
    sampleRate,
    false,
    0,
  );
  const left = new Float32Array((sampleRate / dump.frameRateHz) * dump.frameCount);
  const right = new Float32Array(left.length);
  player.render(left, right);
  return { left, right };
}

test('isolates each PSG channel by masking only the other volume registers', () => {
  const dump = makeDump();
  const expected = {
    A: [23, 15, 0, 0, 56, 5, 0, 0, 10],
    B: [23, 0, 14, 0, 56, 0, 6, 0, 10],
    C: [23, 0, 0, 13, 56, 0, 0, 7, 10],
  };

  for (const channel of ['A', 'B', 'C']) {
    const isolated = isolatePSGChannel(dump, channel);
    assert.deepEqual(Array.from(isolated.writeVals), expected[channel]);
    assert.deepEqual(Array.from(isolated.writeRegs), Array.from(dump.writeRegs));
    assert.deepEqual(Array.from(isolated.frameOffsets), Array.from(dump.frameOffsets));
    assert.equal(isolated.frameRateHz, dump.frameRateHz);
    assert.equal(isolated.frameCount, dump.frameCount);
  }
});

test('does not mutate or alias the source dump', () => {
  const dump = makeDump();
  const originalRegisters = dump.writeRegs.slice();
  const originalValues = dump.writeVals.slice();
  const originalOffsets = dump.frameOffsets.slice();

  const isolated = isolatePSGChannel(dump, 'B');

  assert.notStrictEqual(isolated.writeRegs, dump.writeRegs);
  assert.notStrictEqual(isolated.writeVals, dump.writeVals);
  assert.notStrictEqual(isolated.frameOffsets, dump.frameOffsets);
  assert.deepEqual(dump.writeRegs, originalRegisters);
  assert.deepEqual(dump.writeVals, originalValues);
  assert.deepEqual(dump.frameOffsets, originalOffsets);

  isolated.writeRegs[0] = 255;
  isolated.writeVals[1] = 255;
  isolated.frameOffsets[1] = 99;
  assert.deepEqual(dump.writeRegs, originalRegisters);
  assert.deepEqual(dump.writeVals, originalValues);
  assert.deepEqual(dump.frameOffsets, originalOffsets);
});

test('the three isolated renders sum to the original mixed render', () => {
  const dump = makeDump();
  const mixed = renderDump(dump);
  const isolated = ['A', 'B', 'C'].map((channel) => renderDump(isolatePSGChannel(dump, channel)));

  for (const side of ['left', 'right']) {
    for (let index = 0; index < mixed[side].length; index++) {
      const channelSum = isolated.reduce((sum, render) => sum + render[side][index], 0);
      assert.ok(Math.abs(mixed[side][index] - channelSum) < 1e-6, `${side} sample ${index} differs from isolated sum`);
    }
  }
});

test('rejects unknown channels and malformed dumps', () => {
  const dump = makeDump();
  assert.throws(() => isolatePSGChannel(dump, 'BEEPER'), /unknown channel BEEPER/);
  assert.throws(() => isolatePSGChannel({ ...dump, writeVals: new Uint8Array(1) }, 'A'), /must have equal lengths/);
});

test('builds a self-contained, syntactically valid three-output worklet', () => {
  const source = _buildChannelizedPSGWorkletSource(AYChipCore, AYDumpPlayer);
  let registration;
  const evaluate = new Function('AudioWorkletProcessor', 'registerProcessor', source);

  evaluate(class {}, (name, Processor) => {
    registration = { name, Processor };
  });

  assert.equal(registration.name, 'zxplayer-channelized-psg-v1');
  assert.equal(typeof registration.Processor, 'function');
});
