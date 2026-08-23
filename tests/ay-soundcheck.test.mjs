import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const song = JSON.parse(await readFile(new URL('../songs/ay_soundcheck.json', import.meta.url), 'utf8'));

function patternDuration(definition) {
  if (Array.isArray(definition.events)) {
    return definition.events.reduce((total, event) => total + (event.dur ?? definition.options?.dur ?? 200), 0);
  }

  return definition.notes
    .trim()
    .split(/\s+/)
    .reduce((total, token) => {
      const separator = token.lastIndexOf(':');
      const duration = separator === -1 ? (definition.options?.dur ?? 200) : Number(token.slice(separator + 1));
      return total + duration;
    }, 0);
}

function arrange(track) {
  const segments = [];
  let cursorMs = 0;

  for (const entry of track.arrangement) {
    const definition = track.patterns[entry.pattern];
    const durationMs = patternDuration(definition);
    for (let pass = 1; pass <= (entry.repeat ?? 1); pass += 1) {
      segments.push({ name: entry.pattern, startMs: cursorMs, endMs: cursorMs + durationMs, definition, pass });
      cursorMs += durationMs;
    }
  }

  return { durationMs: cursorMs, segments };
}

const tracks = {
  A: arrange(song.channels.A),
  B: arrange(song.channels.B),
  C: arrange(song.channels.C),
  BEEPER: arrange(song.beeper),
};

function segment(channel, name, pass = 1) {
  return tracks[channel].segments.find((entry) => entry.name === name && entry.pass === pass);
}

function segmentAt(channel, timeMs) {
  return tracks[channel].segments.find(({ startMs, endMs }) => timeMs >= startMs && timeMs < endMs);
}

function noteNames(definition) {
  if (Array.isArray(definition.events)) return definition.events.map((event) => event.note ?? event.freq);
  return definition.notes
    .trim()
    .split(/\s+/)
    .map((token) => token.split(':', 1)[0]);
}

function isSilentDefinition(definition) {
  if (Array.isArray(definition.events)) {
    return definition.events.every(
      (event) =>
        (event.note === 'r' || event.freq === 0) && (event.noise ?? definition.options?.noise ?? false) !== true,
    );
  }
  return noteNames(definition).every((note) => note === 'r') && definition.options?.noise !== true;
}

test('AY Soundcheck keeps every track aligned to exactly 31 seconds', () => {
  assert.equal(song.id, 'ay_soundcheck');
  assert.deepEqual(Object.fromEntries(Object.entries(tracks).map(([channel, track]) => [channel, track.durationMs])), {
    A: 31000,
    B: 31000,
    C: 31000,
    BEEPER: 31000,
  });
});

test('isolated channels, Beeper, chord, and shape 13 occupy the specified windows', () => {
  assert.deepEqual(
    [1000, 3000, 5000, 7000].map((timeMs) =>
      Object.fromEntries(Object.keys(tracks).map((channel) => [channel, segmentAt(channel, timeMs).name])),
    ),
    [
      { A: 'soloLeft', B: 'rest2', C: 'rest4', BEEPER: 'rest6' },
      { A: 'rest2', B: 'soloCentre', C: 'rest4', BEEPER: 'rest6' },
      { A: 'rest4', B: 'rest4', C: 'soloRight', BEEPER: 'rest6' },
      { A: 'rest4', B: 'rest4', C: 'rest2', BEEPER: 'continuous' },
    ],
  );
  for (const [timeMs, activeChannel] of [
    [1000, 'A'],
    [3000, 'B'],
    [5000, 'C'],
    [7000, 'BEEPER'],
  ]) {
    for (const channel of Object.keys(tracks)) {
      if (channel !== activeChannel) assert.equal(isSilentDefinition(segmentAt(channel, timeMs).definition), true);
    }
  }

  assert.deepEqual(segment('A', 'soloLeft'), {
    name: 'soloLeft',
    startMs: 0,
    endMs: 2000,
    definition: song.channels.A.patterns.soloLeft,
    pass: 1,
  });
  assert.equal(song.channels.A.patterns.soloLeft.pan, -1);
  assert.deepEqual(noteNames(song.channels.A.patterns.soloLeft), ['C3']);
  assert.equal(segment('B', 'soloCentre').startMs, 2000);
  assert.equal(segment('B', 'soloCentre').endMs, 4000);
  assert.equal(song.channels.B.patterns.soloCentre.pan, 0);
  assert.deepEqual(noteNames(song.channels.B.patterns.soloCentre), ['E4']);
  assert.equal(segment('C', 'soloRight').startMs, 4000);
  assert.equal(segment('C', 'soloRight').endMs, 6000);
  assert.equal(song.channels.C.patterns.soloRight.pan, 1);
  assert.deepEqual(noteNames(song.channels.C.patterns.soloRight), ['G5']);
  assert.equal(segment('BEEPER', 'continuous').startMs, 6000);
  assert.equal(segment('BEEPER', 'continuous').endMs, 8000);
  assert.deepEqual(song.beeper.patterns.continuous.events, [{ note: 'A5', dur: 2000 }]);

  for (const [channel, pattern] of [
    ['A', 'chordRoot'],
    ['B', 'chordThird'],
    ['C', 'chordFifth'],
  ]) {
    assert.deepEqual([segment(channel, pattern).startMs, segment(channel, pattern).endMs], [8000, 11000]);
  }
  assert.deepEqual(
    [
      noteNames(song.channels.A.patterns.chordRoot),
      noteNames(song.channels.B.patterns.chordThird),
      noteNames(song.channels.C.patterns.chordFifth),
    ],
    [['C3'], ['E4'], ['G4']],
  );

  const envelope = segment('B', 'envelopeHold');
  assert.deepEqual([envelope.startMs, envelope.endMs], [11000, 14000]);
  assert.deepEqual(envelope.definition.events, [{ note: 'A4', dur: 3000, envShape: 13, envCycleDurMs: 25 }]);
});

test('stereo pulses and the constant-frequency sweep cover 14–22 seconds', () => {
  assert.deepEqual(
    tracks.A.segments.filter(({ name }) => name === 'leftPulses').map(({ startMs, endMs }) => [startMs, endMs]),
    [
      [14000, 16000],
      [16000, 18000],
    ],
  );
  assert.equal(song.channels.A.patterns.leftPulses.pan, -1);
  assert.deepEqual(noteNames(song.channels.A.patterns.leftPulses), ['C5', 'r', 'C5', 'r']);
  assert.deepEqual(
    tracks.C.segments.filter(({ name }) => name === 'rightPulses').map(({ startMs, endMs }) => [startMs, endMs]),
    [
      [14000, 16000],
      [16000, 18000],
    ],
  );
  assert.equal(song.channels.C.patterns.rightPulses.pan, 1);
  assert.deepEqual(noteNames(song.channels.C.patterns.rightPulses), ['r', 'G5', 'r', 'G5']);

  const leftToRight = segment('B', 'sweepLeftToRight');
  const rightToLeft = segment('B', 'sweepRightToLeft');
  assert.deepEqual(
    [leftToRight.startMs, leftToRight.endMs, leftToRight.definition.sweep],
    [18000, 20000, { from: -1, to: 1 }],
  );
  assert.deepEqual(
    [rightToLeft.startMs, rightToLeft.endMs, rightToLeft.definition.sweep],
    [20000, 22000, { from: 1, to: -1 }],
  );
  assert.equal(leftToRight.definition.events[0].note, 'A4');
  assert.equal(rightToLeft.definition.events[0].note, 'A4');
});

test('DnB mini-mix spans 22–30 seconds and every track ends with one second of silence', () => {
  for (const [channel, pattern, repeats] of [
    ['A', 'dnbBass', 2],
    ['B', 'dnbDrums', 2],
    ['BEEPER', 'hats', 8],
  ]) {
    const segments = tracks[channel].segments.filter(({ name }) => name === pattern);
    assert.equal(segments.length, repeats);
    assert.equal(segments[0].startMs, 22000);
    assert.equal(segments.at(-1).endMs, 30000);
  }

  const stabs = tracks.C.segments.filter(({ name }) => name === 'stabLeft' || name === 'stabRight');
  assert.equal(stabs.length, 8);
  assert.equal(stabs[0].startMs, 22000);
  assert.equal(stabs.at(-1).endMs, 30000);
  assert.deepEqual(
    stabs.map(({ name }) => name),
    ['stabLeft', 'stabRight', 'stabLeft', 'stabRight', 'stabLeft', 'stabRight', 'stabLeft', 'stabRight'],
  );
  assert.ok(song.channels.B.patterns.dnbDrums.events.some((event) => event.noise === true));
  assert.deepEqual(noteNames(song.beeper.patterns.hats), ['F6', 'r', 'F6', 'r', 'F6', 'r', 'F6', 'r']);

  for (const track of Object.values(tracks)) {
    const finalSegment = track.segments.at(-1);
    assert.equal(finalSegment.name, 'silence');
    assert.deepEqual([finalSegment.startMs, finalSegment.endMs], [30000, 31000]);
    assert.ok(
      finalSegment.definition.events.every((event) => (event.note === 'r' || event.freq === 0) && event.noise !== true),
    );
  }
});
