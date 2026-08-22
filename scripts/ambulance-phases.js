export const AMBULANCE_CHANNELS = Object.freeze(['A', 'B', 'C']);
export const DEFAULT_CROSSFADE_MS = 24;

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function freezeAutomation(points) {
  const automation = [];

  for (const [timeMs, value] of points) {
    const previous = automation.at(-1);
    if (previous?.timeMs === timeMs && previous.value === value) continue;
    automation.push(Object.freeze({ timeMs, value }));
  }

  return Object.freeze(automation);
}

function createCrossfade(from, to, boundaryMs, halfWidthMs) {
  return Object.freeze({
    from,
    to,
    boundaryMs,
    startMs: boundaryMs - halfWidthMs,
    endMs: boundaryMs + halfWidthMs,
    widthMs: halfWidthMs * 2,
  });
}

export function createAmbulancePhasePlan(
  { approachMs, passMs, recedeMs },
  { crossfadeMs = DEFAULT_CROSSFADE_MS } = {},
) {
  requirePositiveFinite(approachMs, 'approachMs');
  requirePositiveFinite(passMs, 'passMs');
  requirePositiveFinite(recedeMs, 'recedeMs');
  requirePositiveFinite(crossfadeMs, 'crossfadeMs');

  const passStartMs = approachMs;
  const passEndMs = approachMs + passMs;
  const totalMs = passEndMs + recedeMs;
  const requestedHalfWidthMs = crossfadeMs / 2;

  // Each window is centred on its nominal phase boundary. Limiting both pass-side
  // halves to passMs / 2 keeps the two windows disjoint even for a very short pass.
  const approachHalfWidthMs = Math.min(requestedHalfWidthMs, approachMs, passMs / 2);
  const recedeHalfWidthMs = Math.min(requestedHalfWidthMs, recedeMs, passMs / 2);
  const approachCrossfade = createCrossfade('A', 'B', passStartMs, approachHalfWidthMs);
  const recedeCrossfade = createCrossfade('B', 'C', passEndMs, recedeHalfWidthMs);
  const phases = [
    Object.freeze({
      channel: 'A',
      startMs: 0,
      endMs: passStartMs,
      automation: freezeAutomation([
        [0, 1],
        [approachCrossfade.startMs, 1],
        [approachCrossfade.endMs, 0],
        [totalMs, 0],
      ]),
    }),
    Object.freeze({
      channel: 'B',
      startMs: passStartMs,
      endMs: passEndMs,
      automation: freezeAutomation([
        [0, 0],
        [approachCrossfade.startMs, 0],
        [approachCrossfade.endMs, 1],
        [recedeCrossfade.startMs, 1],
        [recedeCrossfade.endMs, 0],
        [totalMs, 0],
      ]),
    }),
    Object.freeze({
      channel: 'C',
      startMs: passEndMs,
      endMs: totalMs,
      automation: freezeAutomation([
        [0, 0],
        [recedeCrossfade.startMs, 0],
        [recedeCrossfade.endMs, 1],
        [totalMs, 1],
      ]),
    }),
  ];

  return Object.freeze({
    totalMs,
    phases: Object.freeze(phases),
    crossfades: Object.freeze([approachCrossfade, recedeCrossfade]),
  });
}

export function getAmbulancePhaseWeights(plan, timeMs) {
  if (!Number.isFinite(timeMs)) throw new TypeError('timeMs must be a finite number.');

  const [approachCrossfade, recedeCrossfade] = plan.crossfades;
  const clampedTimeMs = Math.max(0, Math.min(timeMs, plan.totalMs));

  if (clampedTimeMs <= approachCrossfade.startMs) return { A: 1, B: 0, C: 0 };
  if (clampedTimeMs < approachCrossfade.endMs) {
    const progress =
      (clampedTimeMs - approachCrossfade.startMs) / (approachCrossfade.endMs - approachCrossfade.startMs);
    return { A: 1 - progress, B: progress, C: 0 };
  }
  if (clampedTimeMs <= recedeCrossfade.startMs) return { A: 0, B: 1, C: 0 };
  if (clampedTimeMs < recedeCrossfade.endMs) {
    const progress = (clampedTimeMs - recedeCrossfade.startMs) / (recedeCrossfade.endMs - recedeCrossfade.startMs);
    return { A: 0, B: 1 - progress, C: progress };
  }
  return { A: 0, B: 0, C: 1 };
}

export function scheduleAmbulancePhase(audioParam, startTime, phase) {
  if (!Number.isFinite(startTime)) throw new TypeError('startTime must be a finite number.');
  if (
    !audioParam ||
    typeof audioParam.setValueAtTime !== 'function' ||
    typeof audioParam.linearRampToValueAtTime !== 'function'
  ) {
    throw new TypeError('audioParam must support setValueAtTime() and linearRampToValueAtTime().');
  }

  const [firstPoint, ...remainingPoints] = phase.automation;
  audioParam.setValueAtTime(firstPoint.value, startTime + firstPoint.timeMs / 1000);
  for (const point of remainingPoints) {
    audioParam.linearRampToValueAtTime(point.value, startTime + point.timeMs / 1000);
  }
}
