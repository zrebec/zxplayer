import {
  seq,
  playAY,
  initAudio,
  loadPSG,
  noteToFreq,
  playAYDump,
  AY_MACHINE,
} from 'https://cdn.jsdelivr.net/npm/zx-kit@0.37.0/dist/index.js';

const CHANNELS = ['A', 'B', 'C'];
const SUPPORTED_SCHEMA_VERSION = 1;
const AY_NOTE_OPTION_KEYS = ['vol', 'noise', 'noisePeriod', 'envShape', 'envCycleDurMs'];
const AMB_ZONE_LABEL = { A: 'ĽAVÉ', B: 'STRED (both)', C: 'PRAVÉ' };
const PSG_FORMAT = 'psg';
const PT3_FORMAT = 'pt3';
const JSON_FORMAT = 'json';
const PSG_DEFAULT_MACHINE = 'melodik';
const PSG_PAN_BY_STEREO = {
  mono: { A: 0, B: 0, C: 0 },
  abc: { A: -1, B: 0, C: 1 },
  acb: { A: -1, B: 1, C: 0 },
};
const CHANNEL_INDEX = { A: 0, B: 1, C: 2 };
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
let audioCtx = null;
const psgCache = new Map();

songSelect.addEventListener('change', async () => {
  stopCurrentPlayback({ resetMonitor: true });
  await selectSong(songSelect.value);
});

playBtn.addEventListener('click', () => {
  if (!selectedSong) return;
  void startPlayback(selectedSong);
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
    const format = getDescriptorFormat(song);
    const title = song.artist ? `${song.artist} - ${song.title}` : song.title;
    option.textContent = format === JSON_FORMAT ? title : `${title} [${format.toUpperCase()}]`;
    songSelect.append(option);
  }
}

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
    file: descriptor.file,
    format,
    machine: descriptor.machine ?? PSG_DEFAULT_MACHINE,
    loop: descriptor.loop ?? false,
  };
}

async function selectSong(songId) {
  const descriptor = library.find((song) => song.id === songId);
  if (!descriptor) return;

  selectedSong = null;
  playBtn.disabled = true;
  status.textContent = `Načítavam: ${descriptor.title}…`;
  const format = getDescriptorFormat(descriptor);

  try {
    if (format === PSG_FORMAT) {
      selectedSong = normaliseBinarySong(descriptor, PSG_FORMAT);
      songTitle.textContent = selectedSong.title.toUpperCase();
      songMeta.textContent = describeSong(selectedSong);
      updateChannelLabels(selectedSong);
      resetMonitor();
      status.textContent = 'Pripravené. PLAY načíta PSG dump a spustí raw AY čip cez zx-kit 0.37.';
      playBtn.disabled = false;
      return;
    }

    if (format === PT3_FORMAT) {
      const pt3Song = normaliseBinarySong(descriptor, PT3_FORMAT);
      songTitle.textContent = pt3Song.title.toUpperCase();
      songMeta.textContent = describeSong(pt3Song);
      updateChannelLabels(pt3Song);
      resetMonitor();
      status.textContent = 'PT3 zatiaľ nie je runtime formát. Skonvertuj ho offline na PSG a pridaj .psg súbor.';
      return;
    }

    const response = await fetch(new URL(`../songs/${descriptor.file}`, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const song = await response.json();
    song.format = JSON_FORMAT;
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

async function startPlayback(song) {
  // Toto zostáva synchronné vo vnútri click handlera. Je to dôležité pre autoplay pravidlá prehliadača.
  stopCurrentPlayback({ resetMonitor: false });

  const currentPlaybackId = ++playbackId;
  const startedAt = performance.now();

  if (song.format === PSG_FORMAT) {
    initAudio();
    await startPSGPlayback(song, startedAt, currentPlaybackId);
    return;
  }

  if (song.effect === 'ambulance') {
    const amb = normaliseAmbulance(song.ambulance);
    const totalDurationMs = ambulanceTotalMs(amb);
    activeHandle = playAmbulance(amb);
    playBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = `Prehrávam „${song.title}" — ${formatTime(totalDurationMs)}.`;
    renderAmbulanceMonitor(startedAt, amb, totalDurationMs, currentPlaybackId);
    completionTimerId = globalThis.setTimeout(() => {
      if (currentPlaybackId !== playbackId) return;
      finishPlayback(totalDurationMs);
    }, totalDurationMs + 80);
    return;
  }

  const { tracks, timelines, totalDurationMs } = buildSong(song);
  activeHandle = song.stereo ? playAYStereo(timelines) : playAY({ a: tracks.A, b: tracks.B, c: tracks.C });

  playBtn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = `Prehrávam „${song.title}" — ${formatTime(totalDurationMs)}.`;
  renderMonitor(startedAt, timelines, totalDurationMs, currentPlaybackId);

  completionTimerId = globalThis.setTimeout(() => {
    if (currentPlaybackId !== playbackId) return;
    finishPlayback(totalDurationMs);
  }, totalDurationMs + 80);
}

async function startPSGPlayback(song, startedAt, currentPlaybackId) {
  playBtn.disabled = true;
  stopBtn.disabled = true;
  status.textContent = `Načítavam PSG dump „${song.title}"…`;

  try {
    const dump = await getPSGDump(song);
    if (currentPlaybackId !== playbackId) return;

    const totalDurationMs = (dump.frameCount / dump.frameRateHz) * 1000;
    const machine = AY_MACHINE[song.machine] ?? AY_MACHINE[PSG_DEFAULT_MACHINE];
    const handle = await playAYDump(dump, { loop: Boolean(song.loop), ...machine });
    if (currentPlaybackId !== playbackId) {
      handle.stop();
      return;
    }

    activeHandle = handle;
    playBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = `Prehrávam PSG „${song.title}" — ${formatTime(totalDurationMs)}.`;
    renderPSGMonitor(
      startedAt,
      dump,
      totalDurationMs,
      currentPlaybackId,
      Boolean(song.loop),
      getPSGPanMap(song.machine),
    );

    if (!song.loop) {
      const complete = () => {
        if (currentPlaybackId !== playbackId) return;
        globalThis.clearTimeout(completionTimerId);
        finishPlayback(totalDurationMs);
      };
      completionTimerId = globalThis.setTimeout(complete, totalDurationMs + 120);
      handle.onEnded = complete;
    }
  } catch (error) {
    if (currentPlaybackId !== playbackId) return;
    activeHandle = null;
    playBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = `PSG sa nepodarilo prehrať: ${error.message}`;
  }
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

function getPSGPanMap(machineName) {
  const machine = AY_MACHINE[machineName] ?? AY_MACHINE[PSG_DEFAULT_MACHINE];
  return PSG_PAN_BY_STEREO[machine.stereo] ?? PSG_PAN_BY_STEREO.acb;
}

function renderPSGMonitor(startedAt, dump, totalDurationMs, currentPlaybackId, loop, panMap, state = null) {
  if (currentPlaybackId !== playbackId) return;

  const elapsedRaw = performance.now() - startedAt;
  const elapsedMs = loop && totalDurationMs > 0 ? elapsedRaw % totalDurationMs : Math.min(elapsedRaw, totalDurationMs);
  const frame = Math.min(dump.frameCount - 1, Math.floor((elapsedMs / 1000) * dump.frameRateHz));
  const monitorState = state ?? { regs: new Uint8Array(16), nextFrame: 0 };
  if (frame < monitorState.nextFrame) {
    monitorState.regs.fill(0);
    monitorState.nextFrame = 0;
  }
  applyPSGFrames(dump, monitorState.regs, monitorState.nextFrame, frame);
  monitorState.nextFrame = frame + 1;

  for (const channel of CHANNELS) {
    updatePSGChannel(channel, getPSGChannelState(monitorState.regs, channel, panMap), frame, dump.frameCount);
  }

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (loop || elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderPSGMonitor(startedAt, dump, totalDurationMs, currentPlaybackId, loop, panMap, monitorState);
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
    pan: panMap[channel],
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

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Krátky biely šum na bicie/perkusie (kanály s "noise": true).
function makeNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Vlastný stereo render pre songy s "stereo": true. Každý kanál ide cez vlastný
// StereoPannerNode, takže pan (statický) aj sweep (prelet) sú reálne počuteľné.
// Mono songy naďalej hrajú cez zx-kit playAY a tejto cesty sa netýkajú.
function playAYStereo(timelines) {
  const ctx = ensureAudioContext();
  const startTime = ctx.currentTime + 0.06;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const sources = [];
  const noiseBuffer = makeNoiseBuffer(ctx);
  for (const channel of CHANNELS) {
    const panner = ctx.createStereoPanner();
    panner.connect(master);
    scheduleStereoChannel(ctx, startTime, timelines[channel], panner, sources, noiseBuffer);
  }

  return {
    stop() {
      for (const node of sources) {
        try {
          node.stop();
        } catch {
          // uzol ešte nezačal alebo už skončil — bezpečné ignorovať
        }
      }
      master.disconnect();
    },
  };
}

function scheduleStereoChannel(ctx, startTime, timeline, panner, sources, noiseBuffer) {
  for (const segment of timeline) {
    const segStart = startTime + segment.start / 1000;
    const segEnd = startTime + segment.end / 1000;

    if (segment.sweep) {
      panner.pan.setValueAtTime(segment.sweep.from, segStart);
      panner.pan.linearRampToValueAtTime(segment.sweep.to, segEnd);
    } else {
      panner.pan.setValueAtTime(segment.pan ?? 0, segStart);
    }

    let cursorMs = segment.start;
    for (const { note } of segment.steps) {
      const noteStart = startTime + cursorMs / 1000;
      const durSec = note.dur / 1000;
      cursorMs += note.dur;

      const hasTone = note.freq > 0;
      const hasNoise = note.noise === true;
      if (!hasTone && !hasNoise) continue; // pomlčka (rest) — len posunieme kurzor

      if (hasTone) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(note.freq, noteStart);

        if (segment.sweep) {
          // "nad hlavou": výška vystúpi do vrcholu v strede preletu a zase klesne
          osc.frequency.linearRampToValueAtTime(note.freq * 1.6, noteStart + durSec / 2);
          osc.frequency.linearRampToValueAtTime(note.freq, noteStart + durSec);
        }

        const gain = ctx.createGain();
        applyEnvelope(gain.gain, noteStart, durSec, Boolean(segment.sweep));

        osc.connect(gain);
        gain.connect(panner);
        osc.start(noteStart);
        osc.stop(noteStart + durSec + 0.03);
        sources.push(osc);
      }

      if (hasNoise) {
        // bicie/perkusie — krátky úder bieleho šumu cez ten istý panner
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const gain = ctx.createGain();
        applyEnvelope(gain.gain, noteStart, durSec, false);
        src.connect(gain);
        gain.connect(panner);
        src.start(noteStart);
        src.stop(noteStart + durSec + 0.03);
        sources.push(src);
      }
    }
  }
}

function applyEnvelope(param, startTime, durSec, sustained) {
  const peak = 0.24;
  const attack = 0.006;
  param.setValueAtTime(0.0001, startTime);
  param.exponentialRampToValueAtTime(peak, startTime + attack);
  if (sustained) {
    // súvislý "whoosh" počas preletu
    const release = Math.min(0.05, durSec / 2);
    param.setValueAtTime(peak, startTime + Math.max(attack, durSec - release));
    param.exponentialRampToValueAtTime(0.0001, startTime + durSec);
  } else {
    // perkusné "ping" — rýchly exponenciálny dozvuk
    const decay = Math.min(durSec, 0.38);
    param.exponentialRampToValueAtTime(0.0001, startTime + decay);
  }
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

function ambulanceDopplerAt(amb, ms) {
  const passEnd = amb.approachMs + amb.passMs;
  if (ms <= amb.approachMs) return amb.dopplerApproach;
  if (ms >= passEnd) return amb.dopplerRecede;
  const t = (ms - amb.approachMs) / amb.passMs;
  return amb.dopplerApproach + (amb.dopplerRecede - amb.dopplerApproach) * t;
}

function playAmbulance(amb) {
  const ctx = ensureAudioContext();
  const start = ctx.currentTime + 0.06;
  const total = ambulanceTotalMs(amb);
  const { left, right } = ambulanceEnvelopes(amb);

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  // Nezávislé ucho: vlastný GainNode pre ľavé a pravé, zlúčené cez ChannelMerger.
  const merger = ctx.createChannelMerger(2);
  merger.connect(master);
  const gainL = ctx.createGain();
  const gainR = ctx.createGain();
  gainL.connect(merger, 0, 0); // vstup 0 = ľavý kanál
  gainR.connect(merger, 0, 1); // vstup 1 = pravý kanál

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.connect(gainL);
  osc.connect(gainR);

  // Každé ucho má vlastnú obálku → ľavé/pravé/both sa dajú miešať nezávisle.
  scheduleEnvelope(gainL.gain, start, left);
  scheduleEnvelope(gainR.gain, start, right);

  // DVOJTÓN SIRÉNY + DOPPLER: výška klesá pri prelete a vzďaľovaní
  const sirenSteps = Math.ceil(total / amb.sirenStepMs);
  for (let i = 0; i <= sirenSteps; i += 1) {
    const ms = i * amb.sirenStepMs;
    const base = i % 2 === 0 ? amb.sirenHi : amb.sirenLo;
    osc.frequency.setValueAtTime(base * ambulanceDopplerAt(amb, ms), start + ms / 1000);
  }

  osc.start(start);
  osc.stop(start + total / 1000 + 0.1);

  return {
    stop() {
      try {
        osc.stop();
      } catch {
        // ešte nezačal / už skončil — bezpečné ignorovať
      }
      master.disconnect();
    },
  };
}

function renderAmbulanceMonitor(startedAt, amb, totalDurationMs, currentPlaybackId) {
  if (currentPlaybackId !== playbackId) return;

  const elapsedMs = Math.min(performance.now() - startedAt, totalDurationMs);
  const { left, right } = ambulanceEnvelopes(amb);
  const lv = evalEnvelope(left, elapsedMs);
  const rv = evalEnvelope(right, elapsedMs);
  const bv = Math.min(lv, rv); // "both" = koľko ide do oboch uší naraz
  const passEnd = amb.approachMs + amb.passMs;

  let phase;
  if (elapsedMs < amb.approachMs) phase = '🚑 PRIBLIŽUJE';
  else if (elapsedMs < passEnd) phase = '🚑 PRELET';
  else phase = '🚑 VZĎALUJE';

  const TH = 0.04;
  const norm = (v) => Math.max(0, Math.min(1, v / 0.5));
  const cells = {
    A: { level: lv, home: -1 },
    B: { level: bv * 2, home: 0 },
    C: { level: rv, home: 1 },
  };

  for (const channel of CHANNELS) {
    const view = channelViews[channel];
    const { level, home } = cells[channel];
    const active = level > TH;
    view.element.classList.toggle('is-playing', active);
    view.sequence.textContent = active ? phase : '—';
    view.pass.textContent = active ? `${Math.round(norm(level) * 100)} %` : '—';
    view.step.textContent = active ? AMB_ZONE_LABEL[channel] : '—';
    view.state.textContent = active ? '● znie' : '○ ticho';
    renderPan(view, home, active);
  }

  monitorTime.textContent = `${formatTime(elapsedMs)} / ${formatTime(totalDurationMs)}`;
  monitorProgress.style.width = `${totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0}%`;

  if (elapsedMs < totalDurationMs) {
    animationFrameId = requestAnimationFrame(() => {
      renderAmbulanceMonitor(startedAt, amb, totalDurationMs, currentPlaybackId);
    });
  }
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
    pan: typeof definition.pan === 'number' ? definition.pan : 0,
    sweep: definition.sweep ?? null,
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

function validateAYNote(note, location) {
  if (!Number.isFinite(note.freq) || note.freq < 0) throw new Error(`${location}: freq musí byť nezáporné číslo.`);
  if (!Number.isFinite(note.dur) || note.dur <= 0) throw new Error(`${location}: dur musí byť kladné číslo.`);
  if (note.vol !== undefined && (!Number.isInteger(note.vol) || note.vol < 0 || note.vol > 15)) {
    throw new Error(`${location}: vol musí byť celé číslo od 0 do 15.`);
  }
  if (note.noise !== undefined && typeof note.noise !== 'boolean') {
    throw new Error(`${location}: noise musí byť boolean.`);
  }
  if (
    note.noisePeriod !== undefined &&
    (!Number.isInteger(note.noisePeriod) || note.noisePeriod < 1 || note.noisePeriod > 31)
  ) {
    throw new Error(`${location}: noisePeriod musí byť celé číslo od 1 do 31.`);
  }
  if (note.envShape !== undefined && (!Number.isInteger(note.envShape) || note.envShape < 0 || note.envShape > 15)) {
    throw new Error(`${location}: envShape musí byť celé číslo od 0 do 15.`);
  }
  if (note.envCycleDurMs !== undefined && (!Number.isFinite(note.envCycleDurMs) || note.envCycleDurMs <= 0)) {
    throw new Error(`${location}: envCycleDurMs musí byť kladné číslo.`);
  }
}

function appendPattern(track, timeline, pattern, repeat) {
  for (let pass = 1; pass <= repeat; pass += 1) {
    const start = getTimelineDuration(timeline);
    const end = start + pattern.duration;
    track.push(...pattern.notes);
    timeline.push({
      name: pattern.name,
      start,
      end,
      pass,
      steps: pattern.steps,
      pan: pattern.pan,
      sweep: pattern.sweep,
    });
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

  const span = segment.end - segment.start;
  const pan = segment.sweep
    ? segment.sweep.from + (segment.sweep.to - segment.sweep.from) * (span > 0 ? (elapsedMs - segment.start) / span : 0)
    : (segment.pan ?? 0);

  return {
    ended: false,
    patternName: segment.name,
    pass: segment.pass,
    token: step.token,
    stepIndex: safeStepIndex + 1,
    stepCount: segment.steps.length,
    isPlaying: hasTone || hasNoise,
    soundType,
    pan,
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
  for (const channel of CHANNELS) {
    let fallback = 'CHANNEL';
    if (song.effect === 'ambulance') fallback = AMB_ZONE_LABEL[channel];
    else if (song.format === PSG_FORMAT)
      fallback = `PSG ${channel === 'A' ? 'LEFT' : channel === 'B' ? 'RIGHT' : 'CENTRE'}`;
    else if (song.format === PT3_FORMAT) fallback = 'PT3 SOURCE';
    const label = song.channels?.[channel]?.label ?? fallback;
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
    renderPan(view, 0, false);
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
    panDot: element.querySelector('[data-role="pan-dot"]'),
    panLabel: element.querySelector('[data-role="pan-label"]'),
  };
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
    return `${author}${song.description ?? 'PT3 modul: zdrojový tracker formát. Pre prehranie ho skonvertuj offline na PSG.'}`;
  }
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

  if (song.effect === 'ambulance') {
    if (!song.ambulance || typeof song.ambulance !== 'object') {
      throw new Error('Efekt „ambulance" potrebuje objekt ambulance.');
    }
    return;
  }

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
