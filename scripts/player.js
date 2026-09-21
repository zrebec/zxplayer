import {
  AY_ENVELOPE_SHAPES,
  AY_MACHINE,
  getAudioContext,
  getMasterGain,
  initAudio,
  loadPSG,
  noteToFreq,
  playAY,
  playAYDump,
  playPattern,
  seq,
} from './zx-kit.js';

import { CHANNELS as MONITOR_CHANNELS, createChannelMixer } from './channel-mixer.js';
import { createAmbulancePhasePlan, scheduleAmbulancePhase } from './ambulance-phases.js';
import { loadChannelVolumes, resetChannelVolumes, saveChannelVolumes } from './channel-volume-store.js';
import { materializePatternPan, resolveChannelDefaultPan } from './pattern-pan.js';
import { createPlaybackAdapter } from './playback-adapter.js';
import { createPlaybackClock } from './playback-clock.js';
import { createPlaybackQueue } from './playback-queue.js';
import {
  describeReadyChannels,
  getSongChannelAvailability,
  songHasAudibleAY,
  songUsesAYArrangement,
} from './song-channel-availability.js';
import { describeLibraryCount, filterSongLibrary } from './song-library-filter.js';

const AY_CHANNELS = ['A', 'B', 'C'];
const BEEPER_CHANNEL = 'BEEPER';
const SUPPORTED_SCHEMA_VERSION = 1;
const AY_NOTE_OPTION_KEYS = ['vol', 'noise', 'noisePeriod', 'envShape', 'envCycleDurMs'];
const AMB_PHASE_LABEL = { A: 'PRIBLIŽOVANIE', B: 'PRELET', C: 'VZĎAĽOVANIE' };
const AUDIO_START_DELAY_MS = 120;
const AUDIO_END_TAIL_MS = 80;
const PSG_FORMAT = 'psg';
const PT3_FORMAT = 'pt3';
const JSON_FORMAT = 'json';
const PSG_DEFAULT_MACHINE = 'melodik';
const DEFAULT_COVER = '/assets/covers/fallback/cover.png';
const RIGHTS_LABELS = {
  arrangement: 'Arrangement / module',
  composition: 'Composition',
  cover: 'Cover artwork',
  source: 'Song source',
};
const AY_PAN_BY_STEREO = {
  mono: { A: 0, B: 0, C: 0 },
  abc: { A: -0.6, B: 0, C: 0.6 },
  acb: { A: -0.6, B: 0.6, C: 0 },
};
const PSG_PAN_BY_STEREO = {
  mono: { A: 0, B: 0, C: 0 },
  abc: { A: -0.75, B: 0, C: 0.75 },
  acb: { A: -0.75, B: 0.75, C: 0 },
};
const CHANNEL_INDEX = { A: 0, B: 1, C: 2 };
const songSelect = document.getElementById('songSelect');
const songLibrary = document.getElementById('songLibrary');
const songFilter = document.getElementById('songFilter');
const libraryCount = document.getElementById('libraryCount');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const songCover = document.getElementById('songCover');
const songTitle = document.getElementById('songTitle');
const songArtist = document.getElementById('songArtist');
const songMeta = document.getElementById('songMeta');
const songReleaseYear = document.getElementById('songReleaseYear');
const songOriginalDate = document.getElementById('songOriginalDate');
const songChip = document.getElementById('songChip');
const songFormat = document.getElementById('songFormat');
const rightsBadge = document.getElementById('rightsBadge');
const songRights = document.getElementById('songRights');
const rightsDetails = document.getElementById('rightsDetails');
const resetMixBtn = document.getElementById('resetMixBtn');
const monitorTime = document.getElementById('monitorTime');
const monitorProgress = document.getElementById('monitorProgress');
const stereoMonoBtn = document.getElementById('stereoMonoBtn');
const stereoAcbBtn = document.getElementById('stereoAcbBtn');
const stereoAbcBtn = document.getElementById('stereoAbcBtn');

const channelMixer = createChannelMixer({
  availability: Object.fromEntries(MONITOR_CHANNELS.map((channel) => [channel, false])),
});

let currentStereoMode = 'acb';

const channelViews = Object.fromEntries(
  MONITOR_CHANNELS.map((channel) => [
    channel,
    createChannelView(
      document.getElementById(channel === BEEPER_CHANNEL ? 'channelBeeper' : `channel${channel}`),
      channel,
    ),
  ]),
);

let library = [];
let selectedSong = null;
let activeHandle = null;
let animationFrameId = 0;
let completionTimerId = 0;
let playbackId = 0;
let liveStereoOverridePlaybackId = 0;
let playbackPending = null;
let audioCtx = null;
let selectionId = 0;
const psgCache = new Map();
const psgPlaybackQueue = createPlaybackQueue();
let pendingPSGOptions = null;

stereoMonoBtn?.addEventListener('click', () => setStereoMode('mono'));
stereoAcbBtn?.addEventListener('click', () => setStereoMode('acb'));
stereoAbcBtn?.addEventListener('click', () => setStereoMode('abc'));
songFilter?.addEventListener('input', () => populateSongLibrary(library));

songSelect?.addEventListener('change', async () => {
  stopCurrentPlayback({ resetMonitor: true });
  await selectSong(songSelect.value);
});

playBtn.addEventListener('click', () => {
  if (!selectedSong) return;
  void startPlayback(selectedSong);
});

stopBtn.addEventListener('click', () => {
  if (!activeHandle && !playbackPending) return;
  stopCurrentPlayback({ resetMonitor: true });
  status.textContent = 'Prehrávanie bolo zastavené.';
});

resetMixBtn?.addEventListener('click', () => {
  if (!selectedSong) return;
  channelMixer.resetVolumes();
  resetChannelVolumes(getLocalStorage(), selectedSong.id);
  applyChannelStates();
  status.textContent = `Mixer pre „${selectedSong.title}" bol resetovaný na 100 %.`;
});

async function initialisePlayer() {
  try {
    const response = await fetch(new URL('../songs/index.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const catalog = await response.json();
    library = Array.isArray(catalog.songs) ? catalog.songs : [];
    if (library.length === 0) throw new Error('Register je prázdny.');

    populateSongSelect(library);
    populateSongLibrary(library);
    if (songSelect) songSelect.disabled = false;
    if (songFilter) songFilter.disabled = false;
    await selectSong(library[0].id);
  } catch (error) {
    songTitle.textContent = 'KNIŽNICA SA NENAČÍTALA';
    songMeta.textContent = 'Stránku musíš spúšťať cez lokálny alebo webový server, nie cez file://.';
    status.textContent = `Chyba pri načítaní songs/index.json: ${error.message}`;
  }
}

function populateSongSelect(songs) {
  if (!songSelect) return;
  songSelect.replaceChildren();
  for (const song of songs) {
    const option = document.createElement('option');
    option.value = song.id;
    const format = getDescriptorFormat(song);
    const title = song.artist ? `${song.artist} - ${song.title}` : song.title;
    option.textContent = format === JSON_FORMAT ? title : `${title} [${format.toUpperCase()}]`;
    songSelect.append(option);
  }
}

function populateSongLibrary(songs) {
  if (!songLibrary) return;
  songLibrary.replaceChildren();
  const filteredSongs = filterSongLibrary(songs, songFilter?.value);

  for (const song of filteredSongs) {
    const catalog = song.catalog ?? {};
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'song-card';
    card.dataset.songId = song.id;
    card.setAttribute('aria-pressed', 'false');
    card.setAttribute('aria-label', `Select ${song.title} by ${song.artist ?? 'unknown artist'}`);

    const cover = document.createElement('img');
    cover.className = 'song-card__cover';
    cover.src = catalog.cover ?? DEFAULT_COVER;
    cover.alt = '';
    cover.loading = 'lazy';
    cover.addEventListener('error', useFallbackCover, { once: true });

    const body = document.createElement('span');
    body.className = 'song-card__body';

    const title = document.createElement('span');
    title.className = 'song-card__title';
    title.textContent = song.title;

    const artist = document.createElement('span');
    artist.className = 'song-card__artist';
    artist.textContent = song.artist ?? 'Unknown artist';

    const meta = document.createElement('span');
    meta.className = 'song-card__meta';
    meta.textContent =
      [catalog.releaseYear, catalog.audio?.chip].filter(Boolean).join(' · ') || 'Catalog metadata pending';

    const badge = document.createElement('span');
    badge.className = 'song-card__badge';
    const documented = catalog.rightsStatus === 'documented';
    badge.classList.toggle('is-unverified', !documented);
    badge.textContent = documented ? 'RIGHTS DOCUMENTED' : 'RIGHTS UNVERIFIED';

    body.append(title, artist, meta, badge);
    card.append(cover, body);
    card.addEventListener('click', async () => {
      stopCurrentPlayback({ resetMonitor: true });
      await selectSong(song.id);
    });
    songLibrary.append(card);
  }

  if (filteredSongs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'library__empty';
    empty.textContent = 'NO SIGNAL MATCHES THIS FILTER.';
    songLibrary.append(empty);
  }
  if (libraryCount) libraryCount.textContent = describeLibraryCount(filteredSongs.length, songs.length);
  if (selectedSong) markSelectedSong(selectedSong.id);
  songLibrary.setAttribute('aria-busy', 'false');
}

function markSelectedSong(songId) {
  if (songSelect) songSelect.value = songId;
  for (const card of songLibrary?.querySelectorAll('.song-card') ?? []) {
    const selected = card.dataset.songId === songId;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
    if (selected) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  }
}

function renderSongDetails(song) {
  const catalog = song.catalog ?? {};
  const audio = catalog.audio ?? {};
  const cover = catalog.cover ?? DEFAULT_COVER;

  if (songCover) {
    songCover.src = cover;
    songCover.alt = `ZX Spectrum cover for ${song.title}`;
  }
  if (songTitle) songTitle.textContent = song.title;
  if (songArtist) songArtist.textContent = song.artist ?? 'Unknown artist';
  if (songMeta) songMeta.textContent = describeSong(song);
  if (songReleaseYear) songReleaseYear.textContent = catalog.releaseYear ?? '—';
  if (songOriginalDate) songOriginalDate.textContent = catalog.originalDate ?? '—';
  if (songChip) songChip.textContent = audio.chip ?? 'AY / YM';
  if (songFormat) {
    const source = formatCatalogTerm(audio.sourceFormat ?? getDescriptorFormat(song));
    const runtime = formatCatalogTerm(audio.runtimeFormat ?? 'pending');
    songFormat.textContent = `${source} → ${runtime}`;
  }

  renderRights(catalog.rights, catalog.rightsStatus);
}

function renderRights(rights = {}, rightsStatus = 'unverified') {
  const documented = rightsStatus === 'documented';
  if (rightsBadge) {
    rightsBadge.textContent = documented ? 'RIGHTS DOCUMENTED' : 'RIGHTS UNVERIFIED';
    rightsBadge.classList.toggle('is-documented', documented);
    rightsBadge.classList.toggle('is-unverified', !documented);
  }
  if (songRights) {
    songRights.open = !documented;
    songRights.dataset.status = documented ? 'documented' : 'unverified';
  }
  if (!rightsDetails) return;

  rightsDetails.replaceChildren();
  for (const key of ['composition', 'arrangement', 'source', 'cover']) {
    const entry = rights[key] ?? {
      status: 'unverified',
      label: 'Rights information has not been verified.',
    };
    const row = document.createElement('div');
    row.className = 'rights-row';

    const heading = document.createElement('strong');
    heading.textContent = RIGHTS_LABELS[key];

    const copy = document.createElement('span');
    copy.textContent = `${entry.label} (${formatRightsStatus(entry.status)})`;
    row.append(heading, copy);

    const links = [
      ['View licence', entry.licenseUrl],
      ['View evidence', entry.evidenceUrl],
      ['Legal basis', entry.legalBasisUrl],
    ];
    const linkGroup = document.createElement('span');
    linkGroup.className = 'rights-row__links';
    for (const [label, url] of links) {
      if (!url) continue;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      linkGroup.append(link);
    }
    if (linkGroup.childElementCount > 0) row.append(linkGroup);
    rightsDetails.append(row);
  }
}

function formatCatalogTerm(value) {
  return String(value).replaceAll('-', ' ').replaceAll('_', ' ').toUpperCase();
}

function formatRightsStatus(value) {
  const labels = {
    'all-rights-reserved': 'all rights reserved',
    licensed: 'licensed',
    'public-domain-eu': 'public domain in the EU',
    unverified: 'unverified',
  };
  return labels[value] ?? 'unverified';
}

function useFallbackCover(event) {
  const image = event.currentTarget;
  if (image?.getAttribute('src') !== DEFAULT_COVER) image.src = DEFAULT_COVER;
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadMixerForSong(songId) {
  const volumes = loadChannelVolumes(getLocalStorage(), songId);
  for (const channel of MONITOR_CHANNELS) channelMixer.setVolume(channel, volumes[channel]);
  applyChannelStates();
}

function saveMixerForSong() {
  if (!selectedSong) return;
  const volumes = Object.fromEntries(
    MONITOR_CHANNELS.map((channel) => [channel, channelMixer.getChannelState(channel).volume]),
  );
  saveChannelVolumes(getLocalStorage(), selectedSong.id, volumes);
}

songCover?.addEventListener('error', useFallbackCover);

function getDescriptorFormat(descriptor) {
  if (descriptor.type) return descriptor.type;
  const lower = descriptor.file?.toLowerCase() ?? '';
  if (lower.endsWith('.psg')) return PSG_FORMAT;
  if (lower.endsWith('.pt3')) return PT3_FORMAT;
  return JSON_FORMAT;
}

function normaliseBinarySong(descriptor, format) {
  return {
    id: descriptor.id,
    title: descriptor.title,
    artist: descriptor.artist,
    description: descriptor.description,
    catalog: descriptor.catalog,
    file: descriptor.file,
    format,
    machine: descriptor.machine ?? PSG_DEFAULT_MACHINE,
    loop: descriptor.loop ?? false,
  };
}

async function selectSong(songId) {
  const descriptor = library.find((song) => song.id === songId);
  if (!descriptor) return;
  const currentSelectionId = ++selectionId;

  selectedSong = null;
  loadMixerForSong(descriptor.id);
  setAvailableChannels([]);
  markSelectedSong(descriptor.id);
  renderSongDetails(descriptor);
  playBtn.disabled = true;
  status.textContent = `Načítavam: ${descriptor.title}…`;
  const format = getDescriptorFormat(descriptor);

  try {
    if (format === PSG_FORMAT) {
      selectedSong = normaliseBinarySong(descriptor, PSG_FORMAT);
      setAvailableChannels(AY_CHANNELS);
      renderSongDetails(selectedSong);
      updateChannelLabels(selectedSong);
      resetMonitor();
      status.textContent = 'Pripravené. PLAY načíta PSG dump a spustí raw AY čip cez zx-kit aydump.';
      playBtn.disabled = false;
      return;
    }

    if (format === PT3_FORMAT) {
      const pt3Song = normaliseBinarySong(descriptor, PT3_FORMAT);
      setAvailableChannels([]);
      renderSongDetails(pt3Song);
      updateChannelLabels(pt3Song);
      resetMonitor();
      status.textContent = 'PT3 zatiaľ nie je runtime formát. npm run build ho skonvertuje na PSG.';
      return;
    }

    const response = await fetch(new URL(`../songs/${descriptor.file}`, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const song = await response.json();
    if (currentSelectionId !== selectionId) return;
    song.format = JSON_FORMAT;
    song.catalog = descriptor.catalog ?? song.catalog;
    validateSong(song);
    if (songUsesAYArrangement(song)) buildSong(song);
    selectedSong = song;
    const availableChannels = getSongChannelAvailability(song);
    setAvailableChannels(availableChannels);
    renderSongDetails(song);
    updateChannelLabels(song);
    resetMonitor();
    status.textContent = describeReadyChannels(availableChannels);
    playBtn.disabled = false;
  } catch (error) {
    if (currentSelectionId !== selectionId) return;
    setAvailableChannels([]);
    songTitle.textContent = 'CHYBNÝ SONG JSON';
    songMeta.textContent = descriptor.file;
    status.textContent = `Skladbu sa nepodarilo pripraviť: ${error.message}`;
  }
}

async function startPlayback(song) {
  if (playbackPending) return;
  const pendingToken = Symbol('playback');
  playbackPending = pendingToken;

  // Inicializácia aj resume() sa spustia synchronicky v click handleri; jeho Promise potom bezpečne dočkáme.
  let currentPlaybackId = 0;
  let unownedAYHandle = null;
  let unownedBeeperHandle = null;
  try {
    initAudio();
    audioCtx = getAudioContext();
    if (!audioCtx) throw new Error('AudioContext sa nepodarilo inicializovať.');
    const resumePromise = audioCtx.state === 'running' ? Promise.resolve() : audioCtx.resume();

    stopCurrentPlayback({ resetMonitor: false });
    playbackPending = pendingToken;
    currentPlaybackId = ++playbackId;
    playBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = `Pripravujem zvuk pre „${song.title}"…`;
    await resumePromise;
    if (currentPlaybackId !== playbackId) return;
    if (audioCtx.state !== 'running') {
      throw new Error(`AudioContext nie je pripravený (stav: ${audioCtx.state}).`);
    }

    if (song.format === PSG_FORMAT) {
      await startPSGPlayback(song, currentPlaybackId);
      return;
    }

    const playbackClock = createPlaybackClock(audioCtx, AUDIO_START_DELAY_MS);
    if (song.effect === 'ambulance') {
      const amb = normaliseAmbulance(song.ambulance);
      const phasePlan = createAmbulancePhasePlan(amb);
      const totalDurationMs = phasePlan.totalMs;
      activeHandle = createPlaybackAdapter({
        effectHandle: playAmbulance(amb, phasePlan, playbackClock.audioStartTime),
      });
      applyChannelStates();
      playBtn.disabled = true;
      stopBtn.disabled = false;
      status.textContent = `Prehrávam „${song.title}" — ${formatTime(totalDurationMs)}.`;
      renderAmbulanceMonitor(playbackClock, amb, phasePlan, currentPlaybackId);
      schedulePlaybackCompletion(playbackClock, totalDurationMs, currentPlaybackId);
      return;
    }

    const { tracks, timelines, totalDurationMs } = buildSong(song);
    if (songHasAudibleAY(song)) {
      const initialAYGains = Object.fromEntries(
        AY_CHANNELS.map((channel) => [channel, getChannelOutputLevel(channel)]),
      );
      const authoredPan = Object.fromEntries(
        AY_CHANNELS.filter((channel) => song.ay?.pan?.[channel] !== undefined).map((channel) => [
          channel.toLowerCase(),
          song.ay.pan[channel],
        ]),
      );
      unownedAYHandle = playAY(
        {
          a: tracks.A,
          b: tracks.B,
          c: tracks.C,
          gains: initialAYGains,
          stereo: currentStereoMode,
          ...(Object.keys(authoredPan).length > 0 ? { pan: authoredPan } : {}),
        },
        playbackClock.getStartDelayMs(),
      );
    }
    unownedBeeperHandle = song.beeper
      ? playPattern(
          tracks.BEEPER.map((note) => ({ ...note, pan: song.beeper.pan ?? 0 })),
          playbackClock.getStartDelayMs(),
        )
      : null;
    unownedBeeperHandle?.setGain(getChannelOutputLevel(BEEPER_CHANNEL), 0);
    activeHandle = createPlaybackAdapter({ ayHandle: unownedAYHandle, beeperHandle: unownedBeeperHandle });
    unownedAYHandle = null;
    unownedBeeperHandle = null;
    applyChannelStates();

    playBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = `Prehrávam „${song.title}" — ${formatTime(totalDurationMs)}.`;
    renderMonitor(playbackClock, timelines, totalDurationMs, currentPlaybackId, song);
    schedulePlaybackCompletion(playbackClock, totalDurationMs, currentPlaybackId);
  } catch (error) {
    for (const handle of [unownedAYHandle, unownedBeeperHandle]) {
      try {
        handle?.stop();
      } catch {
        // Pôvodná chyba prehrávania je užitočnejšia než prípadná chyba pri cleanup-e.
      }
    }
    if (currentPlaybackId === 0 || currentPlaybackId === playbackId) {
      stopCurrentPlayback({ resetMonitor: false });
      status.textContent = `Prehrávanie sa nepodarilo spustiť: ${error.message}`;
    }
  } finally {
    if (playbackPending === pendingToken) playbackPending = null;
  }
}

async function startPSGPlayback(song, currentPlaybackId) {
  playBtn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = `Načítavam PSG dump „${song.title}"…`;

  let psgHandle = null;
  let playbackAdapter = null;
  try {
    const dump = await getPSGDump(song);
    if (currentPlaybackId !== playbackId) return;

    const totalDurationMs = (dump.frameCount / dump.frameRateHz) * 1000;
    const machine = AY_MACHINE[song.machine] ?? AY_MACHINE[PSG_DEFAULT_MACHINE];
    psgHandle = await queueAYDumpPlayback(dump, currentPlaybackId, () => {
      const options = {
        loop: Boolean(song.loop),
        ...machine,
        stereo: currentStereoMode,
        volume: 0,
        channelGains: Object.fromEntries(AY_CHANNELS.map((channel) => [channel, getChannelOutputLevel(channel)])),
      };
      pendingPSGOptions = { playbackId: currentPlaybackId, options };
      return options;
    });
    if (!psgHandle) return;
    if (currentPlaybackId !== playbackId) {
      psgHandle.stop();
      return;
    }

    if (!song.loop) {
      psgHandle.onEnded = () => {
        if (currentPlaybackId === playbackId) finishPlayback(totalDurationMs);
      };
    }

    playbackAdapter = createPlaybackAdapter({ psgHandle });
    playbackAdapter.setStereoMode(currentStereoMode);
    for (const channel of AY_CHANNELS) {
      playbackAdapter.setChannelGain(channel, getChannelOutputLevel(channel), 0);
    }
    activeHandle = playbackAdapter;
    if (!psgHandle.playing) {
      finishPlayback(totalDurationMs);
      return;
    }
    psgHandle.setVolume(1);
    applyChannelStates();
    const playbackClock = createPlaybackClock(audioCtx, 0);
    playBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = `Prehrávam PSG „${song.title}" — ${formatTime(totalDurationMs)}.`;
    renderPSGMonitor(playbackClock, dump, totalDurationMs, currentPlaybackId, Boolean(song.loop));
  } catch (error) {
    if (activeHandle === playbackAdapter) activeHandle = null;
    try {
      if (playbackAdapter) playbackAdapter.stop();
      else psgHandle?.stop();
    } catch {
      // Pôvodná chyba prehrávania je užitočnejšia než prípadná chyba pri cleanup-e.
    }
    if (currentPlaybackId !== playbackId) return;
    playBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = `PSG sa nepodarilo prehrať: ${error.message}`;
  } finally {
    if (pendingPSGOptions?.playbackId === currentPlaybackId) pendingPSGOptions = null;
  }
}

function queueAYDumpPlayback(dump, currentPlaybackId, createOptions) {
  return psgPlaybackQueue.enqueue(
    () => playAYDump(dump, createOptions()),
    () => currentPlaybackId === playbackId,
  );
}

async function getPSGDump(song) {
  if (!psgCache.has(song.file)) {
    const url = new URL(`../songs/${song.file}`, import.meta.url);
    const promise = loadPSG(url.href).catch((error) => {
      psgCache.delete(song.file);
      throw error;
    });
    psgCache.set(song.file, promise);
  }
  return psgCache.get(song.file);
}

function getPSGPanMap(modeOrMachine) {
  if (['mono', 'abc', 'acb'].includes(modeOrMachine)) {
    return PSG_PAN_BY_STEREO[modeOrMachine];
  }
  const machine = AY_MACHINE[modeOrMachine] ?? AY_MACHINE[PSG_DEFAULT_MACHINE];
  return PSG_PAN_BY_STEREO[machine.stereo] ?? PSG_PAN_BY_STEREO.acb;
}

function renderPSGMonitor(playbackClock, dump, totalDurationMs, currentPlaybackId, loop, state = null) {
  if (currentPlaybackId !== playbackId) return;

  const elapsedRaw = playbackClock.getElapsedMs();
  const elapsedMs = loop && totalDurationMs > 0 ? elapsedRaw % totalDurationMs : Math.min(elapsedRaw, totalDurationMs);
  const frame = Math.min(dump.frameCount - 1, Math.floor((elapsedMs / 1000) * dump.frameRateHz));
  const monitorState = state ?? { regs: new Uint8Array(16), nextFrame: 0 };
  if (frame < monitorState.nextFrame) {
    monitorState.regs.fill(0);
    monitorState.nextFrame = 0;
  }
  applyPSGFrames(dump, monitorState.regs, monitorState.nextFrame, frame);
  monitorState.nextFrame = frame + 1;

  const effectivePanMap = getPSGPanMap(currentStereoMode);
  for (const channel of AY_CHANNELS) {
    updatePSGChannel(channel, getPSGChannelState(monitorState.regs, channel, effectivePanMap), frame, dump.frameCount);
  }
  markBeeperUnused();

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (loop || elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderPSGMonitor(playbackClock, dump, totalDurationMs, currentPlaybackId, loop, monitorState);
    });
  }
}

function applyPSGFrames(dump, regs, fromFrame, toFrame) {
  for (let frame = fromFrame; frame <= toFrame; frame += 1) {
    const start = dump.frameOffsets[frame];
    const end = dump.frameOffsets[frame + 1];
    for (let i = start; i < end; i += 1) {
      regs[dump.writeRegs[i] & 0x0f] = dump.writeVals[i];
    }
  }
}

function getPSGChannelState(regs, channel, panMap) {
  const index = CHANNEL_INDEX[channel];
  const tonePeriod = ((regs[index * 2 + 1] & 0x0f) << 8) | regs[index * 2];
  const mixer = regs[7];
  const tone = ((mixer >> index) & 1) === 0 && tonePeriod > 0;
  const noise = ((mixer >> (index + 3)) & 1) === 0;
  const volumeRegister = regs[8 + index];
  const envelope = (volumeRegister & 0x10) !== 0;
  const volume = volumeRegister & 0x0f;
  const active = (envelope || volume > 0) && (tone || noise);

  let soundType = 'REST';
  if (tone && noise) soundType = envelope ? 'TONE + NOISE + ENV' : 'TONE + NOISE';
  else if (tone) soundType = envelope ? 'TONE + ENV' : 'TONE';
  else if (noise) soundType = envelope ? 'NOISE + ENV' : 'NOISE';

  return {
    active,
    soundType,
    volume: envelope ? 'ENV' : String(volume),
    tonePeriod,
    noisePeriod: regs[6] & 0x1f,
    pan: panMap[channel] ?? 0,
  };
}

function updatePSGChannel(channel, channelState, frame, frameCount) {
  const view = channelViews[channel];
  view.element.classList.toggle('is-playing', channelState.active);
  view.sequence.textContent = 'PSG REGISTER DUMP';
  view.pass.textContent = `${frame + 1}/${frameCount}`;
  view.step.textContent = `TP ${channelState.tonePeriod} / NP ${channelState.noisePeriod} / VOL ${channelState.volume}`;
  view.state.textContent = `${channelState.active ? '●' : '○'} ${channelState.soundType}`;
  renderPan(view, channelState.pan, channelState.active);
}

function markBeeperUnused() {
  const view = channelViews[BEEPER_CHANNEL];
  view.element.classList.remove('is-playing');
  view.sequence.textContent = '— UNUSED —';
  view.pass.textContent = '—';
  view.step.textContent = '—';
  view.state.textContent = '○ SILENT';
  renderPan(view, 0, false);
}

function ensureAudioContext() {
  audioCtx = getAudioContext();
  if (!audioCtx) throw new Error('AudioContext musí byť inicializovaný používateľským gestom.');
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function getChannelOutputLevel(channel) {
  const channelState = channelMixer.getChannelState(channel);
  return channelState?.audible ? channelState.volume : 0;
}

function toggleMute(channel) {
  channelMixer.toggleMute(channel);
  applyChannelStates();
}

function toggleSolo(channel) {
  channelMixer.toggleSolo(channel);
  applyChannelStates();
}

function setChannelVolume(channel, value) {
  channelMixer.setVolume(channel, value);
  applyChannelStates();
  saveMixerForSong();
}

function setAvailableChannels(channels) {
  const available = new Set(channels);
  channelMixer.setAvailability(
    Object.fromEntries(MONITOR_CHANNELS.map((channel) => [channel, available.has(channel)])),
  );
  applyChannelStates();
}

function setStereoMode(mode) {
  if (!['mono', 'acb', 'abc'].includes(mode)) return;
  currentStereoMode = mode;
  if (pendingPSGOptions?.playbackId === playbackId) {
    pendingPSGOptions.options.stereo = mode;
  }
  if (activeHandle && selectedSong?.format === JSON_FORMAT && !selectedSong.effect) {
    liveStereoOverridePlaybackId = playbackId;
  }
  updateStereoButtons();
  applyStereoModeToAudio();
}

function updateStereoButtons() {
  for (const [button, mode] of [
    [stereoMonoBtn, 'mono'],
    [stereoAcbBtn, 'acb'],
    [stereoAbcBtn, 'abc'],
  ]) {
    const active = currentStereoMode === mode;
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-pressed', String(active));
  }
}

function applyChannelStates() {
  const { soloChannel } = channelMixer.getState();

  for (const ch of MONITOR_CHANNELS) {
    const view = channelViews[ch];
    const channelState = channelMixer.getChannelState(ch);
    const { available, muted: isMuted, solo: isSolo, audible: isAudible, volume } = channelState;

    if (view?.muteBtn) {
      view.muteBtn.classList.toggle('is-active', isMuted);
      view.muteBtn.setAttribute('aria-pressed', String(isMuted));
      view.muteBtn.disabled = !available;
    }
    if (view?.soloBtn) {
      view.soloBtn.classList.toggle('is-active', isSolo);
      view.soloBtn.setAttribute('aria-pressed', String(isSolo));
      view.soloBtn.disabled = !available;
    }
    if (view?.element) {
      view.element.classList.toggle('is-muted', available && isMuted && !isSolo);
      view.element.classList.toggle('is-suppressed', available && soloChannel !== null && !isSolo);
      view.element.classList.toggle('is-unavailable', !available);
      view.element.style.setProperty('--channel-level', String(volume));
    }
    if (view?.volumeRange) {
      view.volumeRange.value = String(Math.round(volume * 100));
      view.volumeRange.disabled = !available;
      view.volumeRange.setAttribute('aria-valuetext', `${Math.round(volume * 100)} percent`);
    }
    if (view?.volumeValue) {
      view.volumeValue.textContent = `${Math.round(volume * 100)}%`;
    }

    const targetGain = isAudible ? volume : 0;
    if (pendingPSGOptions?.playbackId === playbackId && ch !== BEEPER_CHANNEL) {
      pendingPSGOptions.options.channelGains[ch] = targetGain;
    }
    activeHandle?.setChannelGain(ch, targetGain, 15);
  }
}

function applyStereoModeToAudio() {
  activeHandle?.setStereoMode(currentStereoMode);
}

// ── Efekt "ambulance": čistá Dopplerovská sanitka ───────────────────────────
// Príchod sprava (tón silnie), prelet ponad hlavu (pravé → stred → ľavé)
// s klesajúcou výškou (Doppler) a vzďaľovanie doľava (tón slabne). Jeden súvislý
// dvojtón sirény, plynule automatizovaný pan / hlasitosť / výška.
function normaliseAmbulance(a = {}) {
  return {
    approachMs: a.approachMs ?? 4000,
    passMs: a.passMs ?? 2800,
    recedeMs: a.recedeMs ?? 3400,
    panFrom: typeof a.panFrom === 'number' ? a.panFrom : 1,
    panTo: typeof a.panTo === 'number' ? a.panTo : -1,
    sirenHi: a.sirenHi ?? 760,
    sirenLo: a.sirenLo ?? 580,
    sirenStepMs: a.sirenStepMs ?? 560,
    dopplerApproach: a.dopplerApproach ?? 1.06,
    dopplerRecede: a.dopplerRecede ?? 0.9,
  };
}

function ambulanceTotalMs(amb) {
  return amb.approachMs + amb.passMs + amb.recedeMs;
}

// Obálky hlasitosti zvlášť pre ľavé a pravé ucho (nezávislé GainNody).
// [časMs, hlasitosť]. "Both" = úsek, kde sú obe naraz hore (vrchol v strede preletu).
function ambulanceEnvelopes(amb) {
  const a = amb.approachMs;
  const p = amb.passMs;
  const total = ambulanceTotalMs(amb);
  const center = a + p / 2;
  const passEnd = a + p;
  const recede = total - passEnd;
  const rightSilent = passEnd + recede * 0.2; // pravé dohorí krátko po prelete → "both" skončí
  const leftTail = passEnd + recede * 0.6; // ľavé znie SAMO ešte dlho potom
  return {
    right: [
      [0, 0.02],
      [a * 0.6, 0.18],
      [a, 0.4],
      [center, 0.46],
      [passEnd, 0.1],
      [rightSilent, 0.0001],
      [total, 0.0001],
    ],
    left: [
      [0, 0.0001],
      [a, 0.0001],
      [center, 0.3],
      [passEnd, 0.5],
      [leftTail, 0.32],
      [total, 0.0001],
    ],
  };
}

function evalEnvelope(points, ms) {
  if (ms <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [t1, v1] = points[i];
    if (ms <= t1) {
      const [t0, v0] = points[i - 1];
      const span = t1 - t0;
      return span > 0 ? v0 + (v1 - v0) * ((ms - t0) / span) : v1;
    }
  }
  return points[points.length - 1][1];
}

function scheduleEnvelope(param, startTime, points) {
  param.setValueAtTime(points[0][1], startTime + points[0][0] / 1000);
  for (let i = 1; i < points.length; i += 1) {
    param.linearRampToValueAtTime(points[i][1], startTime + points[i][0] / 1000);
  }
}

function holdAudioParam(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
  } else {
    const heldValue = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(heldValue, time);
  }
}

function ambulanceDopplerAt(amb, ms) {
  const passEnd = amb.approachMs + amb.passMs;
  if (ms <= amb.approachMs) return amb.dopplerApproach;
  if (ms >= passEnd) return amb.dopplerRecede;
  const t = (ms - amb.approachMs) / amb.passMs;
  return amb.dopplerApproach + (amb.dopplerRecede - amb.dopplerApproach) * t;
}

function playAmbulance(amb, phasePlan, start) {
  const ctx = ensureAudioContext();
  const output = getMasterGain();
  if (!output) throw new Error('Zdieľaný hlavný audio výstup nie je inicializovaný.');
  const total = phasePlan.totalMs;
  const { left, right } = ambulanceEnvelopes(amb);

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(output);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const channelGains = new Map();

  // Všetky fázy nesú ten istý spojitý oscilátor. Komplementárne lineárne okná sa
  // na hraniciach sčítajú na 1, takže plný mix zostáva rovnaký a bez kliknutia.
  for (const phase of phasePlan.phases) {
    const gainL = ctx.createGain();
    const gainR = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    const phaseWindow = ctx.createGain();
    const channelGain = ctx.createGain();

    osc.connect(gainL);
    osc.connect(gainR);
    gainL.connect(merger, 0, 0);
    gainR.connect(merger, 0, 1);
    merger.connect(phaseWindow);
    phaseWindow.connect(channelGain);
    channelGain.connect(master);

    scheduleEnvelope(gainL.gain, start, left);
    scheduleEnvelope(gainR.gain, start, right);
    scheduleAmbulancePhase(phaseWindow.gain, start, phase);
    channelGain.gain.value = getChannelOutputLevel(phase.channel);
    channelGains.set(phase.channel, channelGain);
  }

  // DVOJTÓN SIRÉNY + DOPPLER: výška klesá pri prelete a vzďaľovaní
  const sirenSteps = Math.ceil(total / amb.sirenStepMs);
  for (let i = 0; i <= sirenSteps; i += 1) {
    const ms = i * amb.sirenStepMs;
    const base = i % 2 === 0 ? amb.sirenHi : amb.sirenLo;
    osc.frequency.setValueAtTime(base * ambulanceDopplerAt(amb, ms), start + ms / 1000);
  }

  osc.start(start);
  osc.stop(start + total / 1000 + 0.1);

  let stopped = false;
  return {
    setChannelGain(channel, gain, rampMs = 15) {
      const channelGain = channelGains.get(channel);
      if (!channelGain || stopped || !Number.isFinite(gain) || !Number.isFinite(rampMs)) return;
      const now = ctx.currentTime;
      const target = Math.max(0, Math.min(1, gain));
      holdAudioParam(channelGain.gain, now);
      channelGain.gain.linearRampToValueAtTime(target, now + Math.max(0, rampMs) / 1000);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        osc.stop();
      } catch {
        // ešte nezačal / už skončil — bezpečné ignorovať
      }
      channelGains.clear();
      master.disconnect();
    },
  };
}

function renderAmbulanceMonitor(playbackClock, amb, phasePlan, currentPlaybackId) {
  if (currentPlaybackId !== playbackId) return;

  const totalDurationMs = phasePlan.totalMs;
  const elapsedMs = Math.min(playbackClock.getElapsedMs(), totalDurationMs);
  const { left, right } = ambulanceEnvelopes(amb);
  const lv = evalEnvelope(left, elapsedMs);
  const rv = evalEnvelope(right, elapsedMs);
  const phase =
    phasePlan.phases.find(({ startMs, endMs }) => elapsedMs >= startMs && elapsedMs < endMs) ?? phasePlan.phases.at(-1);
  const phaseDuration = phase.endMs - phase.startMs;
  const phaseProgress = phaseDuration > 0 ? (elapsedMs - phase.startMs) / phaseDuration : 1;
  const pan = lv + rv > 0 ? (rv - lv) / (lv + rv) : 0;

  for (const channel of AY_CHANNELS) {
    const view = channelViews[channel];
    const active = channel === phase.channel;
    view.element.classList.toggle('is-playing', active);
    view.sequence.textContent = active ? `🚑 ${AMB_PHASE_LABEL[phase.channel]}` : '—';
    view.pass.textContent = active ? `${Math.round(Math.max(0, Math.min(1, phaseProgress)) * 100)} %` : '—';
    view.step.textContent = active ? `${formatTime(phase.startMs)}–${formatTime(phase.endMs)}` : '—';
    view.state.textContent = active ? '● AKTÍVNA FÁZA' : '○ ČAKÁ';
    renderPan(view, pan, active);
  }
  markBeeperUnused();

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderAmbulanceMonitor(playbackClock, amb, phasePlan, currentPlaybackId);
    });
  }
}

function buildSong(song) {
  const tracks = { A: [], B: [], C: [], BEEPER: [] };
  const timelines = { A: [], B: [], C: [], BEEPER: [] };
  const stereoPan = AY_PAN_BY_STEREO[currentStereoMode] ?? AY_PAN_BY_STEREO.acb;

  for (const channel of AY_CHANNELS) {
    const channelData = song.channels[channel];
    const defaultPan = resolveChannelDefaultPan(song.ay?.pan?.[channel], stereoPan[channel]);
    const patterns = Object.fromEntries(
      Object.entries(channelData.patterns).map(([name, definition]) => [name, createAYPattern(name, definition)]),
    );

    for (const entry of channelData.arrangement) {
      const pattern = patterns[entry.pattern];
      if (!pattern) {
        throw new Error(`Kanál ${channel}: neexistujúci pattern „${entry.pattern}".`);
      }
      appendPattern(tracks[channel], timelines[channel], pattern, entry.repeat ?? 1, defaultPan);
    }
  }

  if (song.beeper) {
    const patterns = Object.fromEntries(
      Object.entries(song.beeper.patterns).map(([name, definition]) => [name, createBeeperPattern(name, definition)]),
    );

    for (const entry of song.beeper.arrangement) {
      const pattern = patterns[entry.pattern];
      if (!pattern) throw new Error(`Beeper: neexistujúci pattern „${entry.pattern}".`);
      appendPattern(tracks.BEEPER, timelines.BEEPER, pattern, entry.repeat ?? 1);
    }
    // Beeper pan je na úrovni stopy — prenes ho do segmentov, nech ho monitor vidí.
    for (const segment of timelines.BEEPER) segment.pan = song.beeper.pan ?? 0;
  }

  return {
    tracks,
    timelines,
    totalDurationMs: Math.max(...MONITOR_CHANNELS.map((channel) => getTimelineDuration(timelines[channel]))),
  };
}

function createAYPattern(name, definition) {
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
    pan: typeof definition.pan === 'number' ? definition.pan : undefined,
    sweep: definition.sweep ?? null,
  };
}

function createBeeperPattern(name, definition) {
  const options = definition.options ?? {};
  let notes;
  let tokens;

  if (typeof definition.notes === 'string') {
    notes = seq(definition.notes, { dur: options.dur }).map(({ freq, dur }) => ({ freq, dur }));
    tokens = definition.notes.trim().split(/\s+/);
  } else if (Array.isArray(definition.events)) {
    notes = definition.events.map((event, index) => createBeeperNoteFromEvent(name, event, options, index));
    tokens = definition.events.map((event) => event.token ?? event.note ?? formatFrequencyToken(event.freq));
  } else {
    throw new Error(`Beeper pattern „${name}" potrebuje notes alebo events.`);
  }

  if (notes.length === 0) throw new Error(`Beeper pattern „${name}" je prázdny.`);
  if (notes.length !== tokens.length) throw new Error(`Beeper pattern „${name}" sa nepodarilo rozparsovať.`);
  notes.forEach((note, index) => validateBeeperNote(note, `Beeper pattern „${name}", krok ${index + 1}`));

  return {
    name,
    notes,
    duration: notes.reduce((total, note) => total + note.dur, 0),
    steps: notes.map((note, index) => ({ note, token: tokens[index] })),
  };
}

function createBeeperNoteFromEvent(patternName, event, defaults, index) {
  if (!event || typeof event !== 'object') {
    throw new Error(`Beeper pattern „${patternName}", event ${index + 1}: očakávam objekt.`);
  }

  const hasNamedNote = typeof event.note === 'string';
  const hasFrequency = Number.isFinite(event.freq);
  if (hasNamedNote === hasFrequency) {
    throw new Error(`Beeper pattern „${patternName}", event ${index + 1}: zadaj práve jedno z note alebo freq.`);
  }

  const note = {
    freq: hasNamedNote ? noteToFreq(event.note) : event.freq,
    dur: event.dur ?? defaults.dur ?? 200,
  };
  validateBeeperNote(note, `Beeper pattern „${patternName}", event ${index + 1}`);
  return note;
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

  const note = {
    freq: hasNamedNote ? noteToFreq(event.note) : event.freq,
    dur: event.dur ?? defaults.dur ?? 200,
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

function appendPattern(track, timeline, pattern, repeat, defaultPan = 0) {
  for (let pass = 1; pass <= repeat; pass += 1) {
    const start = getTimelineDuration(timeline);
    const end = start + pattern.duration;
    const positioned = materializePatternPan(pattern, defaultPan);
    track.push(...positioned.notes);
    timeline.push({
      name: pattern.name,
      start,
      end,
      pass,
      steps: pattern.steps,
      pan: positioned.pan,
      sweep: positioned.sweep,
    });
  }
}

function renderMonitor(playbackClock, timelines, totalDurationMs, currentPlaybackId, song) {
  if (currentPlaybackId !== playbackId) return;

  const elapsedMs = Math.min(playbackClock.getElapsedMs(), totalDurationMs);
  const panPreset = AY_PAN_BY_STEREO[currentStereoMode] ?? AY_PAN_BY_STEREO.acb;
  const liveStereoOverride = liveStereoOverridePlaybackId === currentPlaybackId;
  for (const channel of MONITOR_CHANNELS) {
    const defaultPan =
      channel === BEEPER_CHANNEL
        ? (song.beeper?.pan ?? 0)
        : liveStereoOverride
          ? (panPreset[channel] ?? 0)
          : (song.ay?.pan?.[channel] ?? panPreset[channel] ?? 0);
    updateChannel(
      channel,
      getPlaybackState(
        timelines[channel],
        elapsedMs,
        channel === BEEPER_CHANNEL,
        defaultPan,
        liveStereoOverride && channel !== BEEPER_CHANNEL,
      ),
    );
  }

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderMonitor(playbackClock, timelines, totalDurationMs, currentPlaybackId, song);
    });
  }
}

function getPlaybackState(timeline, elapsedMs, isBeeper = false, defaultPan = 0, ignoreAuthoredPan = false) {
  if (timeline.length === 0) return { unused: true };
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

  if (isBeeper && hasTone) soundType = 'BEEP';
  else if (hasTone && hasNoise) soundType = 'TONE + NOISE';
  else if (hasTone) soundType = 'TONE';
  else if (hasNoise) soundType = 'NOISE';
  else soundType = 'REST';

  const soundDetails = [];
  if (isBeeper) {
    // Beeper nemá AY volume register, envelope generátor ani noise period.
  } else if ((hasTone || hasNoise) && step.note.envShape !== undefined) {
    soundDetails.push(`ENV ${step.note.envShape} ${AY_ENVELOPE_SHAPES[step.note.envShape]}`);
  } else if (hasTone || hasNoise) {
    soundDetails.push(`VOL ${step.note.vol ?? 15}`);
  }
  if (hasNoise) soundDetails.push(`NP ${step.note.noisePeriod ?? 8}`);

  const span = segment.end - segment.start;
  const pan = ignoreAuthoredPan
    ? defaultPan
    : segment.sweep
      ? segment.sweep.from +
        (segment.sweep.to - segment.sweep.from) * (span > 0 ? (elapsedMs - segment.start) / span : 0)
      : (segment.pan ?? defaultPan);

  return {
    ended: false,
    patternName: segment.name,
    pass: segment.pass,
    token: step.token,
    stepIndex: safeStepIndex + 1,
    stepCount: segment.steps.length,
    isPlaying: hasTone || hasNoise,
    soundType: [soundType, ...soundDetails].join(' · '),
    pan,
  };
}

function updateChannel(channel, playbackState) {
  const view = channelViews[channel];
  if (playbackState.unused) {
    view.element.classList.remove('is-playing');
    view.sequence.textContent = '— UNUSED —';
    view.pass.textContent = '—';
    view.step.textContent = '—';
    view.state.textContent = '○ SILENT';
    renderPan(view, 0, false);
    return;
  }
  if (playbackState.ended) {
    view.element.classList.remove('is-playing');
    view.sequence.textContent = '— END —';
    view.pass.textContent = '—';
    view.step.textContent = '—';
    view.state.textContent = '○ FINISHED';
    renderPan(view, 0, false);
    return;
  }

  view.element.classList.toggle('is-playing', playbackState.isPlaying);
  view.sequence.textContent = playbackState.patternName;
  view.pass.textContent = String(playbackState.pass);
  view.step.textContent = `${playbackState.stepIndex}/${playbackState.stepCount}  ${playbackState.token}`;
  view.state.textContent = `${playbackState.isPlaying ? '●' : '○'} ${playbackState.soundType}`;
  renderPan(view, playbackState.pan ?? 0, playbackState.isPlaying);
}

// Vizuálny ukazovateľ, do ktorého ucha kanál práve znie. Bodka beží po osi L——R,
// štítok píše ◀ LEFT / ◆ BOTH / RIGHT ▶. Keď kanál mlčí, meter je stlmený.
function renderPan(view, pan, active) {
  if (!view.panDot || !view.panLabel) return;
  const clamped = Math.max(-1, Math.min(1, pan));
  view.panDot.style.left = `${((clamped + 1) / 2) * 100}%`;
  view.panDot.classList.toggle('is-active', active);

  let label;
  if (clamped <= -0.5) label = '◀ LEFT';
  else if (clamped >= 0.5) label = 'RIGHT ▶';
  else label = '◆ BOTH';

  view.panLabel.textContent = active ? label : '—';
  view.panLabel.classList.toggle('is-active', active);
}

function updateChannelLabels(song) {
  for (const channel of AY_CHANNELS) {
    let fallback = 'CHANNEL';
    if (song.effect === 'ambulance') fallback = AMB_PHASE_LABEL[channel];
    else if (song.format === PSG_FORMAT) fallback = 'PSG VOICE';
    else if (song.format === PT3_FORMAT) fallback = 'PT3 SOURCE';
    const label = song.channels?.[channel]?.label ?? fallback;
    const view = channelViews[channel];
    view.name.textContent = `${channel} / ${label}`;
    view.element.setAttribute('aria-label', `Kanál ${channel}, ${label}`);
  }

  const beeperLabel = song.beeper?.label ?? 'UNUSED';
  const beeperView = channelViews[BEEPER_CHANNEL];
  beeperView.name.textContent = `BEEPER / ${beeperLabel}`;
  beeperView.element.setAttribute('aria-label', `Beeper, ${beeperLabel}`);
}

function resetMonitor() {
  cancelAnimationFrame(animationFrameId);
  monitorTime.textContent = '0:00.00 / 0:00.00';
  monitorProgress.style.width = '0%';

  for (const channel of MONITOR_CHANNELS) {
    const view = channelViews[channel];
    view.element.classList.remove('is-playing');
    const unused = !channelMixer.getChannelState(channel).available;
    view.sequence.textContent = unused ? '— UNUSED —' : 'WAITING';
    view.pass.textContent = '—';
    view.step.textContent = '—';
    view.state.textContent = unused ? '○ SILENT' : '○ WAITING';
    renderPan(view, 0, false);
  }
}

function schedulePlaybackCompletion(playbackClock, totalDurationMs, currentPlaybackId) {
  const checkCompletion = () => {
    if (currentPlaybackId !== playbackId) return;
    const remainingMs = playbackClock.getRemainingMs(totalDurationMs + AUDIO_END_TAIL_MS);
    if (remainingMs <= 0) {
      finishPlayback(totalDurationMs);
      return;
    }
    completionTimerId = globalThis.setTimeout(checkCompletion, Math.min(250, Math.max(16, remainingMs)));
  };
  checkCompletion();
}

function stopPlaybackHandle(handle) {
  try {
    handle?.stop();
  } catch (error) {
    console.error('Zvukový handle sa nepodarilo korektne zastaviť.', error);
  }
}

function finishPlayback(totalDurationMs) {
  cancelAnimationFrame(animationFrameId);
  globalThis.clearTimeout(completionTimerId);
  const handle = activeHandle;
  activeHandle = null;
  stopPlaybackHandle(handle);
  playbackPending = null;
  playBtn.disabled = false;
  stopBtn.disabled = true;
  status.textContent = `Hotovo. Prehraté za ${formatTime(totalDurationMs)}.`;
}

function stopCurrentPlayback({ resetMonitor: shouldResetMonitor }) {
  cancelAnimationFrame(animationFrameId);
  globalThis.clearTimeout(completionTimerId);
  playbackPending = null;
  playbackId += 1;
  const handle = activeHandle;
  activeHandle = null;
  stopPlaybackHandle(handle);
  stopBtn.disabled = true;
  playBtn.disabled = selectedSong === null;
  if (shouldResetMonitor) resetMonitor();
}

function createChannelView(element, channel) {
  const view = {
    channel,
    element,
    name: element.querySelector('[data-role="channel-name"]'),
    muteBtn: element.querySelector('[data-role="mute-btn"]'),
    soloBtn: element.querySelector('[data-role="solo-btn"]'),
    sequence: element.querySelector('[data-role="sequence"]'),
    pass: element.querySelector('[data-role="pass"]'),
    step: element.querySelector('[data-role="step"]'),
    state: element.querySelector('[data-role="state"]'),
    panDot: element.querySelector('[data-role="pan-dot"]'),
    panLabel: element.querySelector('[data-role="pan-label"]'),
    volumeRange: element.querySelector('[data-role="volume-range"]'),
    volumeValue: element.querySelector('[data-role="volume-value"]'),
  };

  view.muteBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute(channel);
  });

  view.soloBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSolo(channel);
  });

  view.volumeRange?.addEventListener('input', (e) => {
    setChannelVolume(channel, Number(e.currentTarget.value) / 100);
  });

  return view;
}

function getTimelineDuration(timeline) {
  return timeline.at(-1)?.end ?? 0;
}

function describeSong(song) {
  const author = song.artist ? `Autor: ${song.artist}. ` : '';
  if (song.format === PSG_FORMAT) {
    return `${author}${song.description ?? `Raw AY PSG dump cez zx-kit aydump (${song.machine ?? PSG_DEFAULT_MACHINE}).`}`;
  }
  if (song.format === PT3_FORMAT) {
    return `${author}${song.description ?? 'PT3 modul: zdrojový tracker formát. npm run build ho skonvertuje na PSG.'}`;
  }
  return `${author}${song.description ?? 'Tri AY kanály a voliteľná beeper stopa riadené cez JSON patterny.'}`;
}

function validateSong(song) {
  if (!song || typeof song !== 'object') throw new Error('Root JSON musí byť objekt.');
  if (song.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Nepodporovaná schemaVersion: ${song.schemaVersion ?? 'chýba'} (očakávam ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }
  if (!song.id || !song.title) throw new Error('Chýba povinné id alebo title.');

  if (song.effect === 'ambulance') {
    if (!song.ambulance || typeof song.ambulance !== 'object') {
      throw new Error('Efekt „ambulance" potrebuje objekt ambulance.');
    }
    return;
  }

  if (!song.channels || typeof song.channels !== 'object') throw new Error('Chýba objekt channels.');

  if (song.ay?.pan !== undefined) {
    if (!song.ay.pan || typeof song.ay.pan !== 'object') throw new Error('ay.pan musí byť objekt.');
    for (const channel of AY_CHANNELS) {
      const value = song.ay.pan[channel];
      if (value !== undefined && (!Number.isFinite(value) || value < -1 || value > 1)) {
        throw new Error(`ay.pan.${channel} musí byť číslo od -1 do 1.`);
      }
    }
  }

  for (const channel of AY_CHANNELS) {
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

  if (song.beeper !== undefined) validateBeeperDefinition(song.beeper);
}

function validateBeeperDefinition(beeper) {
  if (!beeper || typeof beeper !== 'object') throw new Error('beeper musí byť objekt.');
  if (!beeper.patterns || typeof beeper.patterns !== 'object' || !Array.isArray(beeper.arrangement)) {
    throw new Error('Beeper potrebuje patterns a arrangement.');
  }
  if (beeper.label !== undefined && typeof beeper.label !== 'string') {
    throw new Error('beeper.label musí byť string.');
  }
  if (beeper.pan !== undefined && (!Number.isFinite(beeper.pan) || beeper.pan < -1 || beeper.pan > 1)) {
    throw new Error('beeper.pan musí byť číslo od -1 do 1.');
  }

  for (const [name, definition] of Object.entries(beeper.patterns)) {
    validateBeeperPatternDefinition(name, definition);
  }
  for (const [index, entry] of beeper.arrangement.entries()) {
    if (!entry || typeof entry.pattern !== 'string' || !beeper.patterns[entry.pattern]) {
      throw new Error(`Beeper, arrangement ${index + 1}: neplatný pattern.`);
    }
    if (entry.repeat !== undefined && (!Number.isInteger(entry.repeat) || entry.repeat < 1)) {
      throw new Error(`Beeper, arrangement ${index + 1}: repeat musí byť kladné celé číslo.`);
    }
  }
}

function validateBeeperPatternDefinition(name, definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Beeper pattern „${name}": očakávam objekt.`);
  }
  const hasNotes = typeof definition.notes === 'string';
  const hasEvents = Array.isArray(definition.events);
  if (hasNotes === hasEvents) {
    throw new Error(`Beeper pattern „${name}": zadaj práve jedno z notes alebo events.`);
  }
  validateBeeperOptions(definition.options ?? {}, `Beeper pattern „${name}", options`);
  if (hasEvents) {
    for (const [index, event] of definition.events.entries()) {
      if (!event || typeof event !== 'object') {
        throw new Error(`Beeper pattern „${name}", event ${index + 1}: očakávam objekt.`);
      }
      validateBeeperOptions(event, `Beeper pattern „${name}", event ${index + 1}`);
    }
  }
}

function validateBeeperOptions(options, location) {
  if (!options || typeof options !== 'object') throw new Error(`${location}: očakávam objekt.`);
  if (options.dur !== undefined && (!Number.isFinite(options.dur) || options.dur <= 0)) {
    throw new Error(`${location}: dur musí byť kladné číslo.`);
  }
  for (const key of [...AY_NOTE_OPTION_KEYS, 'pan']) {
    if (options[key] !== undefined) throw new Error(`${location}: ${key} nepatrí do beeper options.`);
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

  if (definition.pan !== undefined && (!Number.isFinite(definition.pan) || definition.pan < -1 || definition.pan > 1)) {
    throw new Error(`Kanál ${channel}, pattern „${name}": pan musí byť číslo od -1 do 1.`);
  }
  if (definition.sweep !== undefined) {
    const sweep = definition.sweep;
    const valid =
      sweep &&
      typeof sweep === 'object' &&
      Number.isFinite(sweep.from) &&
      sweep.from >= -1 &&
      sweep.from <= 1 &&
      Number.isFinite(sweep.to) &&
      sweep.to >= -1 &&
      sweep.to <= 1;
    if (!valid) {
      throw new Error(`Kanál ${channel}, pattern „${name}": sweep musí byť objekt { from, to } s číslami od -1 do 1.`);
    }
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

function validateBeeperNote(note, location) {
  if (!Number.isFinite(note.freq) || note.freq < 0) throw new Error(`${location}: freq musí byť nezáporné číslo.`);
  if (!Number.isFinite(note.dur) || note.dur <= 0) throw new Error(`${location}: dur musí byť kladné číslo.`);
}

function formatTime(milliseconds) {
  const centiseconds = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const cents = centiseconds % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
}

function isInteractiveShortcutTarget(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest('a, button, input, select, summary, textarea, [contenteditable="true"], [role="button"]'))
  );
}

window.addEventListener('keydown', (e) => {
  if (isInteractiveShortcutTarget(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (activeHandle || playbackPending) {
      stopCurrentPlayback({ resetMonitor: true });
      status.textContent = 'Prehrávanie bolo zastavené.';
    } else if (selectedSong) {
      void startPlayback(selectedSong);
    }
    return;
  }

  if (e.code === 'Digit1') {
    e.preventDefault();
    if (e.shiftKey) toggleSolo('A');
    else toggleMute('A');
  } else if (e.code === 'Digit2') {
    e.preventDefault();
    if (e.shiftKey) toggleSolo('B');
    else toggleMute('B');
  } else if (e.code === 'Digit3') {
    e.preventDefault();
    if (e.shiftKey) toggleSolo('C');
    else toggleMute('C');
  } else if (e.code === 'Digit4') {
    e.preventDefault();
    if (e.shiftKey) toggleSolo(BEEPER_CHANNEL);
    else toggleMute(BEEPER_CHANNEL);
  } else if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const modes = ['mono', 'acb', 'abc'];
    const nextIndex = (modes.indexOf(currentStereoMode) + 1) % modes.length;
    setStereoMode(modes[nextIndex]);
  }
});

updateStereoButtons();
applyChannelStates();

await initialisePlayer();
