const DEFAULT_LOW_GAIN = 0.0001;
const DEFAULT_HIGH_GAIN = 0.28;

function assertAudioParam(audioParam) {
  if (
    !audioParam ||
    typeof audioParam.cancelScheduledValues !== 'function' ||
    typeof audioParam.setValueAtTime !== 'function' ||
    typeof audioParam.linearRampToValueAtTime !== 'function'
  ) {
    throw new TypeError('audioParam must support Web Audio automation methods.');
  }
}

export function decodeAYEnvelopeShape(shape) {
  if (!Number.isInteger(shape) || shape < 0 || shape > 15) {
    throw new RangeError('AY envelope shape must be an integer from 0 to 15.');
  }

  return Object.freeze({
    CONT: (shape >> 3) & 1,
    ATT: (shape >> 2) & 1,
    ALT: (shape >> 1) & 1,
    HOLD: shape & 1,
  });
}

export function scheduleAYEnvelope(
  audioParam,
  shape,
  cycleDurationSeconds,
  startTimeSeconds,
  cycleCount = 32,
  { lowGain = DEFAULT_LOW_GAIN, highGain = DEFAULT_HIGH_GAIN } = {},
) {
  assertAudioParam(audioParam);
  if (!Number.isFinite(cycleDurationSeconds) || cycleDurationSeconds <= 0) {
    throw new RangeError('cycleDurationSeconds must be a positive finite number.');
  }
  if (!Number.isFinite(startTimeSeconds) || startTimeSeconds < 0) {
    throw new RangeError('startTimeSeconds must be a non-negative finite number.');
  }
  if (!Number.isInteger(cycleCount) || cycleCount <= 0) {
    throw new RangeError('cycleCount must be a positive integer.');
  }
  if (!Number.isFinite(lowGain) || !Number.isFinite(highGain) || lowGain < 0 || highGain <= lowGain) {
    throw new RangeError('Envelope gain range must contain finite values with highGain greater than lowGain.');
  }

  const { CONT, ATT, ALT, HOLD } = decodeAYEnvelopeShape(shape);
  const ramp = (from, to, time) => {
    audioParam.setValueAtTime(from, time);
    audioParam.linearRampToValueAtTime(to, time + cycleDurationSeconds);
  };

  audioParam.cancelScheduledValues(startTimeSeconds);

  if (!CONT) {
    // Shapes 0–7 always run once and then hold low; ALT and HOLD are ignored.
    ramp(ATT ? lowGain : highGain, ATT ? highGain : lowGain, startTimeSeconds);
    audioParam.setValueAtTime(lowGain, startTimeSeconds + cycleDurationSeconds);
    return;
  }

  if (HOLD) {
    ramp(ATT ? lowGain : highGain, ATT ? highGain : lowGain, startTimeSeconds);
    const holdGain = ATT ? (ALT ? lowGain : highGain) : ALT ? highGain : lowGain;
    audioParam.setValueAtTime(holdGain, startTimeSeconds + cycleDurationSeconds);
    return;
  }

  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    const time = startTimeSeconds + cycle * cycleDurationSeconds;
    const goesUp = ALT ? (ATT ? cycle % 2 === 0 : cycle % 2 === 1) : ATT === 1;
    ramp(goesUp ? lowGain : highGain, goesUp ? highGain : lowGain, time);
  }
}
