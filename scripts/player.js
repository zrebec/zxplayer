import { seq, playAY } from 'https://cdn.jsdelivr.net/npm/zx-kit@0.35.0/dist/index.js';

const CHANNELS = ['A', 'B', 'C'];
const SUPPORTED_SCHEMA_VERSION = 1;
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
      Object.entries(channelData.patterns).map(([name, definition]) => [
        name,
        createPattern(name, definition.notes, definition.options ?? {}),
      ]),
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

function createPattern(name, notesSpec, options) {
  const notes = seq(notesSpec, options);
  const tokens = notesSpec.trim().split(/\s+/);

  if (notes.length === 0) throw new Error(`Pattern „${name}" je prázdny.`);
  if (notes.length !== tokens.length) throw new Error(`Pattern „${name}" sa nepodarilo rozparsovať.`);

  return {
    name,
    notes,
    duration: notes.reduce((total, note) => total + note.dur, 0),
    steps: notes.map((note, index) => ({ note, token: tokens[index] })),
  };
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

  return {
    ended: false,
    patternName: segment.name,
    pass: segment.pass,
    token: step.token,
    stepIndex: safeStepIndex + 1,
    stepCount: segment.steps.length,
    isPlaying: hasTone || hasNoise,
    soundType,
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

  for (const channel of CHANNELS) {
    const channelData = song.channels[channel];
    if (!channelData?.patterns || !Array.isArray(channelData.arrangement)) {
      throw new Error(`Kanál ${channel} potrebuje patterns a arrangement.`);
    }
  }
}

function formatTime(milliseconds) {
  const centiseconds = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const cents = centiseconds % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
}

await initialisePlayer();
