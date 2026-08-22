const ZX_KIT_CDN_URL = 'https://cdn.jsdelivr.net/npm/zx-kit@0.42.0/dist/index.js';
const CHANNELS = ['A', 'B', 'C'];
const CHANNEL_VOLUME_REGISTERS = { A: 8, B: 9, C: 10 };
const PROCESSOR_NAME = 'zxplayer-channelized-psg-v1';

// Store the in-flight promise, not just a ready flag, so simultaneous play requests
// cannot try to register the same processor twice on one AudioContext.
const workletReadyByContext = new WeakMap();
let zxKitPromise;

function loadZXKit() {
  zxKitPromise ??= import(/* @vite-ignore */ ZX_KIT_CDN_URL);
  return zxKitPromise;
}

function assertDump(dump) {
  if (
    !dump ||
    !(dump.writeRegs instanceof Uint8Array) ||
    !(dump.writeVals instanceof Uint8Array) ||
    !(dump.frameOffsets instanceof Uint32Array)
  ) {
    throw new TypeError('isolatePSGChannel: expected a parsed zx-kit AYDump');
  }
  if (dump.writeRegs.length !== dump.writeVals.length) {
    throw new RangeError('isolatePSGChannel: writeRegs and writeVals must have equal lengths');
  }
}

function maskedWriteValues(dump, targetRegister) {
  const values = dump.writeVals.slice();
  for (let index = 0; index < dump.writeRegs.length; index++) {
    const register = dump.writeRegs[index];
    if (register >= 8 && register <= 10 && register !== targetRegister) values[index] = 0;
  }
  return values;
}

/**
 * Return an independent copy of a dump containing only one audible AY channel.
 * Shared tone, noise, mixer and envelope writes stay intact; only the other two
 * amplitude registers are forced to zero.
 */
export function isolatePSGChannel(dump, channel) {
  assertDump(dump);
  const targetRegister = CHANNEL_VOLUME_REGISTERS[channel];
  if (targetRegister === undefined) throw new RangeError(`isolatePSGChannel: unknown channel ${channel}`);

  return {
    ...dump,
    writeRegs: dump.writeRegs.slice(),
    writeVals: maskedWriteValues(dump, targetRegister),
    frameOffsets: dump.frameOffsets.slice(),
  };
}

function buildWorkletSource(AYChipCore, AYDumpPlayer) {
  const chipClass = '__ZXPlayerAYChipCore';
  const playerClass = '__ZXPlayerAYDumpPlayer';

  return `const ${chipClass} = ${AYChipCore.toString()};
const ${playerClass} = ${AYDumpPlayer.toString()};
registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, class extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chips = []
    this.players = []
    this.endedPosted = false
    this.stopped = false
    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'load') {
        const writeRegs = new Uint8Array(data.writeRegs)
        const frameOffsets = new Uint32Array(data.frameOffsets)
        this.chips = data.writeVals.map(() => new ${chipClass}(
          sampleRate, data.clockHz, data.envSteps, data.dac, data.stereo
        ))
        this.players = this.chips.map((chip, channel) => new ${playerClass}(
          chip, writeRegs, new Uint8Array(data.writeVals[channel]), frameOffsets,
          data.frameRateHz, sampleRate, data.loop, data.loopFrame
        ))
        this.endedPosted = false
      } else if (data.type === 'stereo') {
        for (const chip of this.chips) chip.setStereo(data.mode)
      } else if (data.type === 'stop') {
        this.stopped = true
        this.players = []
        this.chips = []
      }
    }
  }

  process(_inputs, outputs) {
    if (this.stopped) return false
    if (this.players.length !== 3) return true

    let ended = true
    for (let channel = 0; channel < 3; channel++) {
      const output = outputs[channel]
      const channelEnded = this.players[channel].render(output[0], output[1])
      ended = ended && channelEnded
    }
    if (ended && !this.endedPosted) {
      this.endedPosted = true
      this.port.postMessage({ type: 'ended' })
    }
    return true
  }
})`;
}

export function _buildChannelizedPSGWorkletSource(AYChipCore, AYDumpPlayer) {
  return buildWorkletSource(AYChipCore, AYDumpPlayer);
}

function ensureWorklet(ctx, AYChipCore, AYDumpPlayer) {
  const existing = workletReadyByContext.get(ctx);
  if (existing) return existing;

  const source = buildWorkletSource(AYChipCore, AYDumpPlayer);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const ready = ctx.audioWorklet
    .addModule(url)
    .finally(() => URL.revokeObjectURL(url))
    .catch((error) => {
      if (workletReadyByContext.get(ctx) === ready) workletReadyByContext.delete(ctx);
      throw error;
    });
  workletReadyByContext.set(ctx, ready);
  return ready;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('playChannelizedPSG: setup was cancelled');
  error.name = 'AbortError';
  throw error;
}

/**
 * Play a parsed PSG dump through one AudioWorkletNode with synchronized A/B/C
 * stereo outputs. initAudio() must already have run from the user's gesture.
 */
export async function playChannelizedPSG(dump, opts = {}) {
  assertDump(dump);
  throwIfAborted(opts.signal);
  const zxKit = await loadZXKit();
  throwIfAborted(opts.signal);
  const ctx = zxKit.getAudioContext();
  const master = zxKit.getMasterGain();
  if (!ctx || !master) {
    throw new Error('playChannelizedPSG: call initAudio() inside a user gesture first');
  }
  if (!ctx.audioWorklet || typeof globalThis.AudioWorkletNode !== 'function') {
    throw new Error('playChannelizedPSG: AudioWorklet is not supported by this browser');
  }

  await ensureWorklet(ctx, zxKit.AYChipCore, zxKit.AYDumpPlayer);
  throwIfAborted(opts.signal);

  const variant = opts.variant ?? 'ay';
  const config = {
    clockHz: opts.clockHz ?? 1_773_400,
    envSteps: variant === 'ym' ? 32 : 16,
    dac: Array.from(opts.dacTable ?? zxKit.AY_VOL),
    stereo: opts.stereo ?? 'acb',
  };
  const isolated = CHANNELS.map((channel) => isolatePSGChannel(dump, channel));
  const writeRegs = dump.writeRegs.slice();
  const frameOffsets = dump.frameOffsets.slice();
  const writeVals = isolated.map((channelDump) => channelDump.writeVals);
  const initialVolume = clamp01(opts.volume ?? 1);
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 3,
    outputChannelCount: [2, 2, 2],
  });
  const channelGains = {};
  let playing = true;
  let stopped = false;

  try {
    for (let index = 0; index < CHANNELS.length; index++) {
      const gain = ctx.createGain();
      gain.gain.value = initialVolume * clamp01(opts.channelVolumes?.[CHANNELS[index]] ?? 1);
      node.connect(gain, index, 0);
      gain.connect(master);
      channelGains[CHANNELS[index]] = gain;
    }

    node.port.postMessage(
      {
        type: 'load',
        ...config,
        writeRegs,
        writeVals,
        frameOffsets,
        frameRateHz: dump.frameRateHz,
        loop: Boolean(opts.loop),
        loopFrame: opts.loopFrame ?? 0,
      },
      [writeRegs.buffer, ...writeVals.map((values) => values.buffer), frameOffsets.buffer],
    );
  } catch (error) {
    try {
      node.disconnect();
    } catch {
      // The node may not have reached a connected state.
    }
    for (const gain of Object.values(channelGains)) {
      try {
        gain.disconnect();
      } catch {
        // A partially constructed graph may already be disconnected.
      }
    }
    throw error;
  }

  const handle = {
    channelGains,
    onEnded: null,
    get playing() {
      return playing;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      playing = false;
      node.port.onmessage = null;
      node.port.postMessage({ type: 'stop' });
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
      for (const gain of Object.values(channelGains)) {
        try {
          gain.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    },
    setStereo(mode) {
      if (!stopped) node.port.postMessage({ type: 'stereo', mode });
    },
  };

  node.port.onmessage = (event) => {
    if (event.data?.type !== 'ended' || !playing) return;
    playing = false;
    handle.onEnded?.();
  };

  return handle;
}
