import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CROSSFADE_MS,
  createAmbulancePhasePlan,
  getAmbulancePhaseWeights,
  scheduleAmbulancePhase,
} from '../scripts/ambulance-phases.js';

const EPSILON = 1e-12;

function assertValidWeights(weights) {
  const values = Object.values(weights);
  assert.ok(values.every((value) => value >= 0 && value <= 1));
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < EPSILON);
  assert.ok(values.filter((value) => value > EPSILON).length <= 2);
}

test('creates nominal A, B, and C phases with default 24 ms crossfades', () => {
  const plan = createAmbulancePhasePlan({ approachMs: 4000, passMs: 2800, recedeMs: 5200 });

  assert.equal(DEFAULT_CROSSFADE_MS, 24);
  assert.equal(plan.totalMs, 12000);
  assert.deepEqual(
    plan.phases.map(({ channel, startMs, endMs }) => ({ channel, startMs, endMs })),
    [
      { channel: 'A', startMs: 0, endMs: 4000 },
      { channel: 'B', startMs: 4000, endMs: 6800 },
      { channel: 'C', startMs: 6800, endMs: 12000 },
    ],
  );
  assert.deepEqual(plan.crossfades, [
    { from: 'A', to: 'B', boundaryMs: 4000, startMs: 3988, endMs: 4012, widthMs: 24 },
    { from: 'B', to: 'C', boundaryMs: 6800, startMs: 6788, endMs: 6812, widthMs: 24 },
  ]);
});

test('crossfade weights are linear and complementary at both boundaries', () => {
  const plan = createAmbulancePhasePlan({ approachMs: 100, passMs: 80, recedeMs: 60 });

  assert.deepEqual(getAmbulancePhaseWeights(plan, 100), { A: 0.5, B: 0.5, C: 0 });
  assert.deepEqual(getAmbulancePhaseWeights(plan, 180), { A: 0, B: 0.5, C: 0.5 });
  assert.deepEqual(getAmbulancePhaseWeights(plan, -10), { A: 1, B: 0, C: 0 });
  assert.deepEqual(getAmbulancePhaseWeights(plan, 1000), { A: 0, B: 0, C: 1 });
});

test('short and unequal phases keep windows disjoint and weights partitioned', () => {
  const durations = [
    { approachMs: 0.001, passMs: 0.001, recedeMs: 0.001 },
    { approachMs: 1, passMs: 100, recedeMs: 2 },
    { approachMs: 100, passMs: 1, recedeMs: 100 },
    { approachMs: 0.25, passMs: 48, recedeMs: 0.125 },
    { approachMs: 500, passMs: 0.001, recedeMs: 1 },
  ];

  for (const item of durations) {
    const plan = createAmbulancePhasePlan(item);
    const [firstWindow, secondWindow] = plan.crossfades;

    assert.ok(firstWindow.startMs >= 0);
    assert.ok(firstWindow.endMs <= secondWindow.startMs);
    assert.ok(secondWindow.endMs <= plan.totalMs);

    for (let sample = 0; sample <= 1000; sample += 1) {
      assertValidWeights(getAmbulancePhaseWeights(plan, (plan.totalMs * sample) / 1000));
    }

    for (const window of plan.crossfades) {
      assertValidWeights(getAmbulancePhaseWeights(plan, window.startMs));
      assertValidWeights(getAmbulancePhaseWeights(plan, window.boundaryMs));
      assertValidWeights(getAmbulancePhaseWeights(plan, window.endMs));
    }
  }
});

test('automation points describe the same complementary phase windows', () => {
  const plan = createAmbulancePhasePlan({ approachMs: 20, passMs: 10, recedeMs: 5 });
  const [firstWindow, secondWindow] = plan.crossfades;
  const byChannel = Object.fromEntries(plan.phases.map((phase) => [phase.channel, phase]));

  assert.equal(firstWindow.endMs, secondWindow.startMs);
  assert.deepEqual(byChannel.A.automation.at(-1), { timeMs: plan.totalMs, value: 0 });
  assert.deepEqual(byChannel.C.automation.at(0), { timeMs: 0, value: 0 });
  assert.ok(byChannel.B.automation.some(({ timeMs, value }) => timeMs === firstWindow.endMs && value === 1));
  assert.ok(byChannel.B.automation.some(({ timeMs, value }) => timeMs === secondWindow.startMs && value === 1));
});

test('schedules each phase as piecewise-linear AudioParam automation', () => {
  const plan = createAmbulancePhasePlan({ approachMs: 100, passMs: 80, recedeMs: 60 });
  const calls = [];
  const audioParam = {
    setValueAtTime(value, time) {
      calls.push(['set', value, time]);
    },
    linearRampToValueAtTime(value, time) {
      calls.push(['ramp', value, time]);
    },
  };

  scheduleAmbulancePhase(audioParam, 2, plan.phases[0]);

  assert.deepEqual(calls, [
    ['set', 1, 2],
    ['ramp', 1, 2.088],
    ['ramp', 0, 2.112],
    ['ramp', 0, 2.24],
  ]);
});

test('rejects non-positive durations and crossfade widths', () => {
  assert.throws(() => createAmbulancePhasePlan({ approachMs: 0, passMs: 10, recedeMs: 10 }), /approachMs/);
  assert.throws(() => createAmbulancePhasePlan({ approachMs: 10, passMs: Number.NaN, recedeMs: 10 }), /passMs/);
  assert.throws(
    () => createAmbulancePhasePlan({ approachMs: 10, passMs: 10, recedeMs: 10 }, { crossfadeMs: 0 }),
    /crossfadeMs/,
  );
});
