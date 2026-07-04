import { AY_ENVELOPE_SHAPES, noteToFreq, playAY, seq } from 'https://cdn.jsdelivr.net/npm/zx-kit@0.36.0/dist/index.js';

const CHANNELS = ['A', 'B', 'C'];
const SUPPORTED_SCHEMA_VERSION = 1;
const AY_NOTE_OPTION_KEYS = ['vol', 'noise', 'noisePeriod', 'envShape', 'envCycleDurMs'];
const songSelect = document.getElementById('songSelect');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const songTitle = document.getElementById('songTitle');
const songMeta = document.getElementById('songMeta');
const monitorTime = document.getElementById('monitorTime');
const monitorProgress = document.getElementById('monitorProgress');

const channelViews = Object.fromEntries(
  CHANNELS.map((channel) => [channel, createChannelView(document.getElementById(`channel${channel}`))]),
);

let library = [];
let selectedSong = null;
let activeHandle = null;
let animationFrameId = 0;
let completionTimerId = 0;
let playbackId = 0;

songSelect.addEventListener('change', async () => {
  stopCurrentPlayback({ resetMonitor: true });
  await selectSong(songSelect.value);
});

playBtn.addEventListener('click', () => {
  if (!selectedSong) return;
  startPlayback(selectedSong);
});

stopBtn.addEventListener('click', () => {
  if (!activeHandle) return;
  stopCurrentPlayback({ resetMonitor: true });
  status.textContent = 'Prehrávanie bolo zastavené.';
});

async function initialisePlayer() {
  try {
    const response = await fetch(new URL('../songs/index.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const catalog = await response.json();
    library = Array.isArray(catalog.songs) ? catalog.songs : [];
    if (library.length === 0) throw new Error('Register je prázdny.');

    populateSongSelect(library);
    songSelect.disabled = false;
    await selectSong(library[0].id);
  } catch (error) {
    songTitle.textContent = 'KNIŽNICA SA NENAČÍTALA';
    songMeta.textContent = 'Stránku musíš spúšťať cez lokálny alebo webový server, nie cez file://.';
    status.textContent = `Chyba pri načítaní songs/index.json: ${error.message}`;
  }
}

function populateSongSelect(songs) {
  songSelect.replaceChildren();
  for (const song of songs) {
    const option = document.createElement('option');
    option.value = song.id;
    option.textContent = song.artist ? `${song.artist} - ${song.title}` : song.title;
    songSelect.append(option);
  }
}

async function selectSong(songId) {
  const descriptor = library.find((song) => song.id === songId);
  if (!descriptor) return;

  selectedSong = null;
  playBtn.disabled = true;
  status.textContent = `Načítavam: ${descriptor.title}…`;

  try {
    const response = await fetch(new URL(`../songs/${descriptor.file}`, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const song = await response.json();
    validateSong(song);
    buildSong(song);
    selectedSong = song;
    songTitle.textContent = song.title.toUpperCase();
    songMeta.textContent = describeSong(song);
    updateChannelLabels(song);
    resetMonitor();
    status.textContent = 'Pripravené. PLAY odomkne AudioContext a spustí všetky tri AY kanály.';
    playBtn.disabled = false;
  } catch (error) {
    songTitle.textContent = 'CHYBNÝ SONG JSON';
    songMeta.textContent = descriptor.file;
    status.textContent = `Skladbu sa nepodarilo pripraviť: ${error.message}`;
  }
}

function startPlayback(song) {
  // Toto zostáva synchronné vo vnútri click handlera. Je to dôležité pre autoplay pravidlá prehliadača.
  stopCurrentPlayback({ resetMonitor: false });

  const { tracks, timelines, totalDurationMs } = buildSong(song);
  const currentPlaybackId = ++playbackId;
  const startedAt = performance.now();

  activeHandle = playAY({
    a: tracks.A,
    b: tracks.B,
    c: tracks.C,
    pan: getAYPan(song),
  });

  playBtn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = `Prehrávam „${song.title}" — ${formatTime(totalDurationMs)}.`;
  renderMonitor(startedAt, timelines, totalDurationMs, currentPlaybackId);

  completionTimerId = globalThis.setTimeout(() => {
    if (currentPlaybackId !== playbackId) return;
    finishPlayback(totalDurationMs);
  }, totalDurationMs + 80);
}

function buildSong(song) {
  const tracks = { A: [], B: [], C: [] };
  const timelines = { A: [], B: [], C: [] };

  for (const channel of CHANNELS) {
    const channelData = song.channels[channel];
    const patterns = Object.fromEntries(
      Object.entries(channelData.patterns).map(([name, definition]) => [name, createPattern(name, definition)]),
    );

    for (const entry of channelData.arrangement) {
      const pattern = patterns[entry.pattern];
      if (!pattern) {
        throw new Error(`Kanál ${channel}: neexistujúci pattern „${entry.pattern}".`);
      }
      appendPattern(tracks[channel], timelines[channel], pattern, entry.repeat ?? 1);
    }
  }

  return {
    tracks,
    timelines,
    totalDurationMs: Math.max(...CHANNELS.map((channel) => getTimelineDuration(timelines[channel]))),
  };
}

function createPattern(name, definition) {
  const options = definition.options ?? {};
  let notes;
  let tokens;

  if (typeof definition.notes === 'string') {
    notes = seq(definition.notes, {
      dur: options.dur,
      noise: options.noise,
      noisePeriod: options.noisePeriod,
    }).map((note) => applyAYNoteOptions(note, options));
    tokens = definition.notes.trim().split(/\s+/);
  } else if (Array.isArray(definition.events)) {
    notes = definition.events.map((event, index) => createAYNoteFromEvent(name, event, options, index));
    tokens = definition.events.map((event) => event.token ?? event.note ?? formatFrequencyToken(event.freq));
  } else {
    throw new Error(`Pattern „${name}" potrebuje notes alebo events.`);
  }

  if (notes.length === 0) throw new Error(`Pattern „${name}" je prázdny.`);
  if (notes.length !== tokens.length) throw new Error(`Pattern „${name}" sa nepodarilo rozparsovať.`);
  notes.forEach((note, index) => validateAYNote(note, `Pattern „${name}", krok ${index + 1}`));

  return {
    name,
    notes,
    duration: notes.reduce((total, note) => total + note.dur, 0),
    steps: notes.map((note, index) => ({ note, token: tokens[index] })),
  };
}

function createAYNoteFromEvent(patternName, event, defaults, index) {
  if (!event || typeof event !== 'object') {
    throw new Error(`Pattern „${patternName}", event ${index + 1}: očakávam objekt.`);
  }

  const hasNamedNote = typeof event.note === 'string';
  const hasFrequency = Number.isFinite(event.freq);
  if (hasNamedNote === hasFrequency) {
    throw new Error(`Pattern „${patternName}", event ${index + 1}: zadaj práve jedno z note alebo freq.`);
  }

  const dur = event.dur ?? defaults.dur;
  const note = {
    freq: hasNamedNote ? noteToFreq(event.note) : event.freq,
    dur,
  };
  applyAYNoteOptions(note, defaults);
  applyAYNoteOptions(note, event);
  validateAYNote(note, `Pattern „${patternName}", event ${index + 1}`);
  return note;
}

function applyAYNoteOptions(note, source) {
  for (const key of AY_NOTE_OPTION_KEYS) {
    if (source[key] !== undefined) note[key] = source[key];
  }
  return note;
}

function formatFrequencyToken(frequency) {
  return Number.isFinite(frequency) ? `${frequency}Hz` : '?';
}

function getAYPan(song) {
  const pan = song.ay?.pan;
  if (!pan) return undefined;
  return { a: pan.A, b: pan.B, c: pan.C };
}

function appendPattern(track, timeline, pattern, repeat) {
  for (let pass = 1; pass <= repeat; pass += 1) {
    const start = getTimelineDuration(timeline);
    const end = start + pattern.duration;
    track.push(...pattern.notes);
    timeline.push({ name: pattern.name, start, end, pass, steps: pattern.steps });
  }
}

function renderMonitor(startedAt, timelines, totalDurationMs, currentPlaybackId) {
  if (currentPlaybackId !== playbackId) return;

  const elapsedMs = Math.min(performance.now() - startedAt, totalDurationMs);
  for (const channel of CHANNELS) {
    updateChannel(channel, getPlaybackState(timelines[channel], elapsedMs));
  }

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderMonitor(startedAt, timelines, totalDurationMs, currentPlaybackId);
    });
  }
}

function getPlaybackState(timeline, elapsedMs) {
  const segment = timeline.find(({ start, end }) => elapsedMs >= start && elapsedMs < end);
  if (!segment) return { ended: true };

  let cursorMs = segment.start;
  const stepIndex = segment.steps.findIndex(({ note }) => {
    cursorMs += note.dur;
    return elapsedMs < cursorMs;
  });
  const safeStepIndex = Math.max(0, stepIndex);
  const step = segment.steps[safeStepIndex];
  const hasTone = step.note.freq > 0;
  const hasNoise = step.note.noise === true;
  let soundType;

  if (hasTone && hasNoise) soundType = 'TONE + NOISE';
  else if (hasTone) soundType = 'TONE';
  else if (hasNoise) soundType = 'NOISE';
  else soundType = 'REST';

  const soundDetails = [];
  if ((hasTone || hasNoise) && step.note.envShape !== undefined) {
    soundDetails.push(`ENV ${step.note.envShape} ${AY_ENVELOPE_SHAPES[step.note.envShape]}`);
  } else if (hasTone || hasNoise) {
    soundDetails.push(`VOL ${step.note.vol ?? 15}`);
  }
  if (hasNoise) soundDetails.push(`NP ${step.note.noisePeriod ?? 8}`);

  return {
    ended: false,
    patternName: segment.name,
    pass: segment.pass,
    token: step.token,
    stepIndex: safeStepIndex + 1,
    stepCount: segment.steps.length,
    isPlaying: hasTone || hasNoise,
    soundType: [soundType, ...soundDetails].join(' · '),
  };
}

function updateChannel(channel, playbackState) {
  const view = channelViews[channel];
  if (playbackState.ended) {
    view.element.classList.remove('is-playing');
    view.sequence.textContent = '— END —';
    view.pass.textContent = '—';
    view.step.textContent = '—';
    view.state.textContent = '○ FINISHED';
    return;
  }

  view.element.classList.toggle('is-playing', playbackState.isPlaying);
  view.sequence.textContent = playbackState.patternName;
  view.pass.textContent = String(playbackState.pass);
  view.step.textContent = `${playbackState.stepIndex}/${playbackState.stepCount}  ${playbackState.token}`;
  view.state.textContent = `${playbackState.isPlaying ? '●' : '○'} ${playbackState.soundType}`;
}

function updateChannelLabels(song) {
  for (const channel of CHANNELS) {
    const label = song.channels[channel].label ?? 'CHANNEL';
    const view = channelViews[channel];
    view.name.textContent = `${channel} / ${label}`;
    view.element.setAttribute('aria-label', `Kanál ${channel}, ${label}`);
  }
}

function resetMonitor() {
  cancelAnimationFrame(animationFrameId);
  monitorTime.textContent = '0:00.00 / 0:00.00';
  monitorProgress.style.width = '0%';

  for (const channel of CHANNELS) {
    const view = channelViews[channel];
    view.element.classList.remove('is-playing');
    view.sequence.textContent = 'WAITING';
    view.pass.textContent = '—';
    view.step.textContent = '—';
    view.state.textContent = '○ WAITING';
  }
}

function finishPlayback(totalDurationMs) {
  cancelAnimationFrame(animationFrameId);
  activeHandle = null;
  playBtn.disabled = false;
  stopBtn.disabled = true;
  status.textContent = `Hotovo. Prehraté za ${formatTime(totalDurationMs)}.`;
}

function stopCurrentPlayback({ resetMonitor: shouldResetMonitor }) {
  cancelAnimationFrame(animationFrameId);
  globalThis.clearTimeout(completionTimerId);
  playbackId += 1;
  activeHandle?.stop();
  activeHandle = null;
  stopBtn.disabled = true;
  playBtn.disabled = selectedSong === null;
  if (shouldResetMonitor) resetMonitor();
}

function createChannelView(element) {
  return {
    element,
    name: element.querySelector('[data-role="channel-name"]'),
    sequence: element.querySelector('[data-role="sequence"]'),
    pass: element.querySelector('[data-role="pass"]'),
    step: element.querySelector('[data-role="step"]'),
    state: element.querySelector('[data-role="state"]'),
  };
}

function getTimelineDuration(timeline) {
  return timeline.at(-1)?.end ?? 0;
}

function describeSong(song) {
  const author = song.artist ? `Autor: ${song.artist}. ` : '';
  return `${author}${song.description ?? 'Tri AY kanály riadené cez JSON patterny.'}`;
}

function validateSong(song) {
  if (!song || typeof song !== 'object') throw new Error('Root JSON musí byť objekt.');
  if (song.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Nepodporovaná schemaVersion: ${song.schemaVersion ?? 'chýba'} (očakávam ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }
  if (!song.id || !song.title) throw new Error('Chýba povinné id alebo title.');
  if (!song.channels || typeof song.channels !== 'object') throw new Error('Chýba objekt channels.');

  if (song.ay?.pan !== undefined) {
    if (!song.ay.pan || typeof song.ay.pan !== 'object') throw new Error('ay.pan musí byť objekt.');
    for (const channel of CHANNELS) {
      const value = song.ay.pan[channel];
      if (value !== undefined && (!Number.isFinite(value) || value < -1 || value > 1)) {
        throw new Error(`ay.pan.${channel} musí byť číslo od -1 do 1.`);
      }
    }
  }

  for (const channel of CHANNELS) {
    const channelData = song.channels[channel];
    if (!channelData?.patterns || !Array.isArray(channelData.arrangement)) {
      throw new Error(`Kanál ${channel} potrebuje patterns a arrangement.`);
    }

    for (const [name, definition] of Object.entries(channelData.patterns)) {
      validatePatternDefinition(channel, name, definition);
    }

    for (const [index, entry] of channelData.arrangement.entries()) {
      if (!entry || typeof entry.pattern !== 'string' || !channelData.patterns[entry.pattern]) {
        throw new Error(`Kanál ${channel}, arrangement ${index + 1}: neplatný pattern.`);
      }
      if (entry.repeat !== undefined && (!Number.isInteger(entry.repeat) || entry.repeat < 1)) {
        throw new Error(`Kanál ${channel}, arrangement ${index + 1}: repeat musí byť kladné celé číslo.`);
      }
    }
  }
}

function validatePatternDefinition(channel, name, definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Kanál ${channel}, pattern „${name}": očakávam objekt.`);
  }

  const hasNotes = typeof definition.notes === 'string';
  const hasEvents = Array.isArray(definition.events);
  if (hasNotes === hasEvents) {
    throw new Error(`Kanál ${channel}, pattern „${name}": zadaj práve jedno z notes alebo events.`);
  }

  validateAYOptions(definition.options ?? {}, `Kanál ${channel}, pattern „${name}", options`);
  if (hasEvents) {
    for (const [index, event] of definition.events.entries()) {
      validateAYOptions(event, `Kanál ${channel}, pattern „${name}", event ${index + 1}`);
    }
  }
}

function validateAYOptions(options, location) {
  if (!options || typeof options !== 'object') throw new Error(`${location}: očakávam objekt.`);
  if (options.dur !== undefined && (!Number.isFinite(options.dur) || options.dur <= 0)) {
    throw new Error(`${location}: dur musí byť kladné číslo.`);
  }
  if (options.vol !== undefined && (!Number.isInteger(options.vol) || options.vol < 0 || options.vol > 15)) {
    throw new Error(`${location}: vol musí byť celé číslo od 0 do 15.`);
  }
  if (options.noise !== undefined && typeof options.noise !== 'boolean') {
    throw new Error(`${location}: noise musí byť boolean.`);
  }
  if (
    options.noisePeriod !== undefined &&
    (!Number.isInteger(options.noisePeriod) || options.noisePeriod < 1 || options.noisePeriod > 31)
  ) {
    throw new Error(`${location}: noisePeriod musí byť celé číslo od 1 do 31.`);
  }
  if (
    options.envShape !== undefined &&
    (!Number.isInteger(options.envShape) || options.envShape < 0 || options.envShape > 15)
  ) {
    throw new Error(`${location}: envShape musí byť celé číslo od 0 do 15.`);
  }
  if (options.envCycleDurMs !== undefined && (!Number.isFinite(options.envCycleDurMs) || options.envCycleDurMs <= 0)) {
    throw new Error(`${location}: envCycleDurMs musí byť kladné číslo.`);
  }
}

function validateAYNote(note, location) {
  if (!Number.isFinite(note.freq) || note.freq < 0) throw new Error(`${location}: freq musí byť nezáporné číslo.`);
  if (!Number.isFinite(note.dur) || note.dur <= 0) throw new Error(`${location}: dur musí byť kladné číslo.`);
  validateAYOptions(note, location);
}

function formatTime(milliseconds) {
  const centiseconds = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const cents = centiseconds % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
}

await initialisePlayer();
