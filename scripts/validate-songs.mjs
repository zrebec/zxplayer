import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noteToFreq, seq } from 'zx-kit';

const AY_CHANNELS = ['A', 'B', 'C'];
const AY_OPTION_KEYS = ['vol', 'noise', 'noisePeriod', 'envShape', 'envCycleDurMs'];
const SUPPORTED_SCHEMA_VERSION = 1;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const songsDirectory = path.resolve(scriptDirectory, '..', 'songs');

const songFiles = (await readdir(songsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const songIds = new Set();
for (const file of songFiles) {
  const song = JSON.parse(await readFile(path.join(songsDirectory, file), 'utf8'));
  validateSong(song, file);
}

console.log(`Overených ${songFiles.length} skladieb cez zx-kit.`);

function validateSong(song, file) {
  if (!song || typeof song !== 'object') fail(file, 'root musí byť objekt');
  if (song.schemaVersion !== SUPPORTED_SCHEMA_VERSION) fail(file, 'nepodporovaná schemaVersion');
  if (typeof song.id !== 'string' || !song.id) fail(file, 'chýba id');
  if (songIds.has(song.id)) fail(file, `duplicitné id „${song.id}"`);
  songIds.add(song.id);
  if (typeof song.title !== 'string' || !song.title) fail(file, 'chýba title');

  // Efektové songy (napr. Dopplerovská sanitka) nemajú AY kanály — vlastný objekt stačí.
  if (song.effect === 'ambulance') {
    if (!song.ambulance || typeof song.ambulance !== 'object') {
      fail(file, 'efekt „ambulance" potrebuje objekt ambulance');
    }
    return;
  }

  validatePan(song.ay?.pan, file);

  for (const channel of AY_CHANNELS) {
    const channelData = song.channels?.[channel];
    if (!channelData?.patterns || !Array.isArray(channelData.arrangement)) {
      fail(file, `kanál ${channel} potrebuje patterns a arrangement`);
    }

    const compiledPatterns = new Map();
    for (const [name, definition] of Object.entries(channelData.patterns)) {
      compiledPatterns.set(name, compilePattern(file, channel, name, definition));
    }

    for (const [index, entry] of channelData.arrangement.entries()) {
      if (!entry || typeof entry.pattern !== 'string' || !compiledPatterns.has(entry.pattern)) {
        fail(file, `kanál ${channel}, arrangement ${index + 1}: neplatný pattern`);
      }
      if (entry.repeat !== undefined && (!Number.isInteger(entry.repeat) || entry.repeat < 1)) {
        fail(file, `kanál ${channel}, arrangement ${index + 1}: repeat musí byť kladné celé číslo`);
      }
    }
  }

  if (song.beeper !== undefined) validateBeeper(song.beeper, file);
}

function validateBeeper(beeper, file) {
  if (!beeper || typeof beeper !== 'object') fail(file, 'beeper musí byť objekt');
  if (!beeper.patterns || typeof beeper.patterns !== 'object' || !Array.isArray(beeper.arrangement)) {
    fail(file, 'beeper potrebuje patterns a arrangement');
  }
  if (beeper.label !== undefined && typeof beeper.label !== 'string') fail(file, 'beeper.label musí byť string');
  if (beeper.pan !== undefined && (!Number.isFinite(beeper.pan) || beeper.pan < -1 || beeper.pan > 1)) {
    fail(file, 'beeper.pan musí byť číslo od -1 do 1');
  }

  const compiledPatterns = new Map();
  for (const [name, definition] of Object.entries(beeper.patterns)) {
    compiledPatterns.set(name, compileBeeperPattern(file, name, definition));
  }
  for (const [index, entry] of beeper.arrangement.entries()) {
    if (!entry || typeof entry.pattern !== 'string' || !compiledPatterns.has(entry.pattern)) {
      fail(file, `beeper, arrangement ${index + 1}: neplatný pattern`);
    }
    if (entry.repeat !== undefined && (!Number.isInteger(entry.repeat) || entry.repeat < 1)) {
      fail(file, `beeper, arrangement ${index + 1}: repeat musí byť kladné celé číslo`);
    }
  }
}

function compileBeeperPattern(file, name, definition) {
  const location = `${file}, beeper/${name}`;
  if (!definition || typeof definition !== 'object') fail(location, 'pattern musí byť objekt');
  const hasNotes = typeof definition.notes === 'string';
  const hasEvents = Array.isArray(definition.events);
  if (hasNotes === hasEvents) fail(location, 'zadaj práve jedno z notes alebo events');

  const options = definition.options ?? {};
  validateBeeperOptions(options, `${location}, options`);
  let notes;

  if (hasNotes) {
    notes = seq(definition.notes, { dur: options.dur }).map(({ freq, dur }) => ({ freq, dur }));
  } else {
    notes = definition.events.map((event, index) => {
      const eventLocation = `${location}, event ${index + 1}`;
      if (!event || typeof event !== 'object') fail(eventLocation, 'event musí byť objekt');
      validateBeeperOptions(event, eventLocation);
      const hasNamedNote = typeof event.note === 'string';
      const hasFrequency = Number.isFinite(event.freq);
      if (hasNamedNote === hasFrequency) fail(eventLocation, 'zadaj práve jedno z note alebo freq');
      return {
        freq: hasNamedNote ? noteToFreq(event.note) : event.freq,
        dur: event.dur ?? options.dur ?? 200,
      };
    });
  }

  if (notes.length === 0) fail(location, 'pattern je prázdny');
  notes.forEach((note, index) => validateBeeperNote(note, `${location}, krok ${index + 1}`));
  return notes;
}

function compilePattern(file, channel, name, definition) {
  const location = `${file}, ${channel}/${name}`;
  if (!definition || typeof definition !== 'object') fail(location, 'pattern musí byť objekt');
  const hasNotes = typeof definition.notes === 'string';
  const hasEvents = Array.isArray(definition.events);
  if (hasNotes === hasEvents) fail(location, 'zadaj práve jedno z notes alebo events');

  // Pattern-level stereo: statický pan alebo sweep { from, to } pre songy so "stereo": true.
  if (definition.pan !== undefined && (!Number.isFinite(definition.pan) || definition.pan < -1 || definition.pan > 1)) {
    fail(location, 'pan musí byť číslo od -1 do 1');
  }
  if (definition.sweep !== undefined) {
    const sweep = definition.sweep;
    const sweepValid =
      sweep &&
      typeof sweep === 'object' &&
      Number.isFinite(sweep.from) &&
      sweep.from >= -1 &&
      sweep.from <= 1 &&
      Number.isFinite(sweep.to) &&
      sweep.to >= -1 &&
      sweep.to <= 1;
    if (!sweepValid) fail(location, 'sweep musí byť objekt { from, to } s číslami od -1 do 1');
  }

  const options = definition.options ?? {};
  validateOptions(options, `${location}, options`);
  let notes;

  if (hasNotes) {
    notes = seq(definition.notes, {
      dur: options.dur,
      noise: options.noise,
      noisePeriod: options.noisePeriod,
    }).map((note) => applyOptions(note, options));
  } else {
    notes = definition.events.map((event, index) => {
      const eventLocation = `${location}, event ${index + 1}`;
      if (!event || typeof event !== 'object') fail(eventLocation, 'event musí byť objekt');
      validateOptions(event, eventLocation);
      const hasNamedNote = typeof event.note === 'string';
      const hasFrequency = Number.isFinite(event.freq);
      if (hasNamedNote === hasFrequency) fail(eventLocation, 'zadaj práve jedno z note alebo freq');
      const note = {
        freq: hasNamedNote ? noteToFreq(event.note) : event.freq,
        dur: event.dur ?? options.dur,
      };
      applyOptions(note, options);
      applyOptions(note, event);
      return note;
    });
  }

  if (notes.length === 0) fail(location, 'pattern je prázdny');
  notes.forEach((note, index) => validateNote(note, `${location}, krok ${index + 1}`));
  return notes;
}

function applyOptions(note, source) {
  for (const key of AY_OPTION_KEYS) {
    if (source[key] !== undefined) note[key] = source[key];
  }
  return note;
}

function validateNote(note, location) {
  if (!Number.isFinite(note.freq) || note.freq < 0) fail(location, 'freq musí byť nezáporné číslo');
  if (!Number.isFinite(note.dur) || note.dur <= 0) fail(location, 'dur musí byť kladné číslo');
  validateOptions(note, location);
}

function validateOptions(options, location) {
  if (!options || typeof options !== 'object') fail(location, 'očakávam objekt');
  if (options.dur !== undefined && (!Number.isFinite(options.dur) || options.dur <= 0)) {
    fail(location, 'dur musí byť kladné číslo');
  }
  if (options.vol !== undefined && (!Number.isInteger(options.vol) || options.vol < 0 || options.vol > 15)) {
    fail(location, 'vol musí byť celé číslo od 0 do 15');
  }
  if (options.noise !== undefined && typeof options.noise !== 'boolean') fail(location, 'noise musí byť boolean');
  if (
    options.noisePeriod !== undefined &&
    (!Number.isInteger(options.noisePeriod) || options.noisePeriod < 1 || options.noisePeriod > 31)
  ) {
    fail(location, 'noisePeriod musí byť celé číslo od 1 do 31');
  }
  if (
    options.envShape !== undefined &&
    (!Number.isInteger(options.envShape) || options.envShape < 0 || options.envShape > 15)
  ) {
    fail(location, 'envShape musí byť celé číslo od 0 do 15');
  }
  if (options.envCycleDurMs !== undefined && (!Number.isFinite(options.envCycleDurMs) || options.envCycleDurMs <= 0)) {
    fail(location, 'envCycleDurMs musí byť kladné číslo');
  }
}

function validateBeeperOptions(options, location) {
  if (!options || typeof options !== 'object') fail(location, 'očakávam objekt');
  if (options.dur !== undefined && (!Number.isFinite(options.dur) || options.dur <= 0)) {
    fail(location, 'dur musí byť kladné číslo');
  }
  for (const key of [...AY_OPTION_KEYS, 'pan']) {
    if (key !== 'dur' && options[key] !== undefined) {
      fail(location, `${key} nepatrí do beeper options`);
    }
  }
}

function validateBeeperNote(note, location) {
  if (!Number.isFinite(note.freq) || note.freq < 0) fail(location, 'freq musí byť nezáporné číslo');
  if (!Number.isFinite(note.dur) || note.dur <= 0) fail(location, 'dur musí byť kladné číslo');
}

function validatePan(pan, file) {
  if (pan === undefined) return;
  if (!pan || typeof pan !== 'object') fail(file, 'ay.pan musí byť objekt');
  for (const channel of AY_CHANNELS) {
    const value = pan[channel];
    if (value !== undefined && (!Number.isFinite(value) || value < -1 || value > 1)) {
      fail(file, `ay.pan.${channel} musí byť číslo od -1 do 1`);
    }
  }
}

function fail(location, message) {
  throw new Error(`${location}: ${message}.`);
}
