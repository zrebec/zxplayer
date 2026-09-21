import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { seq } from 'zx-kit';

import * as availability from '../scripts/song-channel-availability.js';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a Beeper-only song exposes no silent AY channels', async () => {
  assert.equal(typeof availability.getSongChannelAvailability, 'function');
  const song = JSON.parse(await readFile(path.join(projectDirectory, 'songs', 'one_bit_night_shift.json'), 'utf8'));

  assert.deepEqual(availability.getSongChannelAvailability(song), ['BEEPER']);
  assert.equal(availability.songHasAudibleAY(song), false);
  assert.equal(availability.describeReadyChannels(['BEEPER']), 'Pripravené. PLAY spustí samostatnú beeper stopu.');
});

test('combined arrangements expose their audible AY channels and the independent Beeper', async () => {
  const song = JSON.parse(await readFile(path.join(projectDirectory, 'songs', 'arctic_circuit.json'), 'utf8'));

  assert.deepEqual(availability.getSongChannelAvailability(song), ['A', 'B', 'C', 'BEEPER']);
  assert.equal(availability.songHasAudibleAY(song), true);
  assert.equal(
    availability.describeReadyChannels(['A', 'B', 'C', 'BEEPER']),
    'Pripravené. PLAY spustí tri AY kanály a samostatnú beeper stopu.',
  );
  assert.equal(
    availability.describeReadyChannels(['A', 'B', 'C']),
    'Pripravené. PLAY odomkne AudioContext a spustí všetky tri AY kanály.',
  );
});

test('noise on a rest keeps an AY channel available while unreferenced patterns do not', () => {
  const song = {
    channels: {
      A: {
        patterns: {
          noise: { events: [{ note: 'r', dur: 100, noise: true }] },
          unusedTone: { notes: 'C4' },
        },
        arrangement: [{ pattern: 'noise' }],
      },
      B: { patterns: { silence: { notes: 'r r' } }, arrangement: [{ pattern: 'silence' }] },
      C: { patterns: { silence: { events: [{ freq: 0, dur: 200 }] } }, arrangement: [{ pattern: 'silence' }] },
    },
  };

  assert.deepEqual(availability.getSongChannelAvailability(song), ['A']);
  assert.equal(availability.describeReadyChannels(['A']), 'Pripravené. PLAY spustí AY kanál A.');
});

test('an all-silent arrangement gets an explicit status instead of an empty channel sentence', () => {
  assert.equal(availability.describeReadyChannels([]), 'Pripravené, ale skladba neobsahuje žiadny počuteľný kanál.');
});

test('procedural effects bypass AY arrangement compilation while JSON songs still require it', async () => {
  assert.equal(typeof availability.songUsesAYArrangement, 'function');
  const [effect, song] = await Promise.all([readSong('stereo_ambulance'), readSong('arctic_circuit')]);

  assert.equal(availability.songUsesAYArrangement(effect), false);
  assert.equal(availability.songUsesAYArrangement(song), true);
});

test('every built-in arrangement keeps its AY and optional Beeper timelines aligned', async () => {
  const catalog = JSON.parse(await readFile(path.join(projectDirectory, 'songs', 'index.json'), 'utf8'));

  for (const descriptor of catalog.songs) {
    if (descriptor.type !== 'json') continue;
    const song = await readSong(descriptor.id);
    if (song.effect) continue;
    const durations = Object.values(song.channels).map(channelDuration);
    if (song.beeper) durations.push(channelDuration(song.beeper));
    assert.ok(Math.max(...durations) - Math.min(...durations) < 1, `${descriptor.id}: ${durations.join(', ')} ms`);
  }
});

async function readSong(id) {
  return JSON.parse(await readFile(path.join(projectDirectory, 'songs', `${id}.json`), 'utf8'));
}

function channelDuration(channel) {
  return channel.arrangement.reduce((total, entry) => {
    const pattern = channel.patterns[entry.pattern];
    const patternDuration =
      typeof pattern.notes === 'string'
        ? seq(pattern.notes, { dur: pattern.options?.dur }).reduce((sum, note) => sum + note.dur, 0)
        : pattern.events.reduce((sum, event) => sum + (event.dur ?? pattern.options?.dur ?? 200), 0);
    return total + patternDuration * (entry.repeat ?? 1);
  }, 0);
}
