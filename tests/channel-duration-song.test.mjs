import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const song = JSON.parse(await readFile(new URL('../songs/channel_duration_test.json', import.meta.url), 'utf8'));

function inspectEvents(events) {
  let cursorMs = 0;
  const sounding = [];

  for (const event of events) {
    const startMs = cursorMs;
    cursorMs += event.dur;
    if (event.note !== 'r' && event.freq !== 0) {
      sounding.push({ note: event.note ?? `${event.freq}Hz`, startMs, endMs: cursorMs });
    }
  }

  return { durationMs: cursorMs, sounding };
}

test('duration diagnostic has exact, plainly audible channel windows', () => {
  const a = inspectEvents(song.channels.A.patterns.durationTest.events);
  const b = inspectEvents(song.channels.B.patterns.durationTest.events);
  const c = inspectEvents(song.channels.C.patterns.durationTest.events);
  const beeper = inspectEvents(song.beeper.patterns.durationTest.events);

  assert.deepEqual([a.durationMs, b.durationMs, c.durationMs, beeper.durationMs], [15000, 15000, 15000, 15000]);
  assert.deepEqual(a.sounding, [
    { note: 'C3', startMs: 0, endMs: 2000 },
    { note: 'C3', startMs: 8000, endMs: 11000 },
  ]);
  assert.deepEqual(b.sounding, [
    { note: 'E4', startMs: 2000, endMs: 4000 },
    { note: 'E4', startMs: 8000, endMs: 11000 },
    { note: 'A4', startMs: 11000, endMs: 14000 },
  ]);
  assert.deepEqual(c.sounding, [
    { note: 'G5', startMs: 4000, endMs: 6000 },
    { note: 'G4', startMs: 8000, endMs: 11000 },
  ]);
  assert.deepEqual(beeper.sounding, [{ note: 'A5', startMs: 6000, endMs: 8000 }]);
});

test('final B tone uses the same sustained envelope shape as the Wilhelmus melody', () => {
  const envelopeEvent = song.channels.B.patterns.durationTest.events.find((event) => event.envShape !== undefined);

  assert.deepEqual(envelopeEvent, {
    note: 'A4',
    dur: 3000,
    envShape: 13,
    envCycleDurMs: 25,
  });
});
