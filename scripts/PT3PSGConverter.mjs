import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const songsDirectory = path.join(projectDirectory, 'songs');
const generatedDirectory = path.join(songsDirectory, 'generated');

const FRAME_RATE_HZ = 50;
const MAX_FRAMES = FRAME_RATE_HZ * 240;
const PSG_HEADER_SIZE = 16;
const POSITION_END = 0xff;
const SINGLE_AY_MODE = 0x20;
const DEFAULT_SAMPLE = 1;
const DEFAULT_ORNAMENT = 0;
const LIMITER = Number.MAX_SAFE_INTEGER;
const CHANNELS = 3;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const NOTE_TABLE = {
  PROTRACKER: 0,
  SOUNDTRACKER: 1,
  ASM: 2,
  REAL: 3,
  NATURAL: 4,
};

const COMMAND = {
  GLISS: 'gliss',
  GLISS_NOTE: 'glissNote',
  SAMPLE_OFFSET: 'sampleOffset',
  ORNAMENT_OFFSET: 'ornamentOffset',
  VIBRATE: 'vibrate',
  SLIDE_ENV: 'slideEnv',
  NO_ENVELOPE: 'noEnvelope',
  ENVELOPE: 'envelope',
  NOISE_BASE: 'noiseBase',
};

const FREQUENCY_TABLES = {
  protracker33: [
    0x0c21, 0x0b73, 0x0ace, 0x0a33, 0x09a0, 0x0916, 0x0893, 0x0818, 0x07a4, 0x0736, 0x06ce, 0x066d, 0x0610, 0x05b9,
    0x0567, 0x0519, 0x04d0, 0x048b, 0x0449, 0x040c, 0x03d2, 0x039b, 0x0367, 0x0336, 0x0308, 0x02dc, 0x02b3, 0x028c,
    0x0268, 0x0245, 0x0224, 0x0206, 0x01e9, 0x01cd, 0x01b3, 0x019b, 0x0184, 0x016e, 0x0159, 0x0146, 0x0134, 0x0122,
    0x0112, 0x0103, 0x00f4, 0x00e6, 0x00d9, 0x00cd, 0x00c2, 0x00b7, 0x00ac, 0x00a3, 0x009a, 0x0091, 0x0089, 0x0081,
    0x007a, 0x0073, 0x006c, 0x0066, 0x0061, 0x005b, 0x0056, 0x0051, 0x004d, 0x0048, 0x0044, 0x0040, 0x003d, 0x0039,
    0x0036, 0x0033, 0x0030, 0x002d, 0x002b, 0x0028, 0x0026, 0x0024, 0x0022, 0x0020, 0x001e, 0x001c, 0x001b, 0x0019,
    0x0018, 0x0016, 0x0015, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d, 0x000c,
  ],
  protracker34: [
    0x0c22, 0x0b73, 0x0acf, 0x0a33, 0x09a1, 0x0917, 0x0894, 0x0819, 0x07a4, 0x0737, 0x06cf, 0x066d, 0x0611, 0x05ba,
    0x0567, 0x051a, 0x04d0, 0x048b, 0x044a, 0x040c, 0x03d2, 0x039b, 0x0367, 0x0337, 0x0308, 0x02dd, 0x02b4, 0x028d,
    0x0268, 0x0246, 0x0225, 0x0206, 0x01e9, 0x01ce, 0x01b4, 0x019b, 0x0184, 0x016e, 0x015a, 0x0146, 0x0134, 0x0123,
    0x0112, 0x0103, 0x00f5, 0x00e7, 0x00da, 0x00ce, 0x00c2, 0x00b7, 0x00ad, 0x00a3, 0x009a, 0x0091, 0x0089, 0x0082,
    0x007a, 0x0073, 0x006d, 0x0067, 0x0061, 0x005c, 0x0056, 0x0052, 0x004d, 0x0049, 0x0045, 0x0041, 0x003d, 0x003a,
    0x0036, 0x0033, 0x0031, 0x002e, 0x002b, 0x0029, 0x0027, 0x0024, 0x0022, 0x0020, 0x001f, 0x001d, 0x001b, 0x001a,
    0x0018, 0x0017, 0x0016, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d, 0x000c,
  ],
  soundtracker: [
    0x0ef8, 0x0e10, 0x0d60, 0x0c80, 0x0bd8, 0x0b28, 0x0a88, 0x09f0, 0x0960, 0x08e0, 0x0858, 0x07e0, 0x077c, 0x0708,
    0x06b0, 0x0640, 0x05ec, 0x0594, 0x0544, 0x04f8, 0x04b0, 0x0470, 0x042c, 0x03fd, 0x03be, 0x0384, 0x0358, 0x0320,
    0x02f6, 0x02ca, 0x02a2, 0x027c, 0x0258, 0x0238, 0x0216, 0x01f8, 0x01df, 0x01c2, 0x01ac, 0x0190, 0x017b, 0x0165,
    0x0151, 0x013e, 0x012c, 0x011c, 0x010a, 0x00fc, 0x00ef, 0x00e1, 0x00d6, 0x00c8, 0x00bd, 0x00b2, 0x00a8, 0x009f,
    0x0096, 0x008e, 0x0085, 0x007e, 0x0077, 0x0070, 0x006b, 0x0064, 0x005e, 0x0059, 0x0054, 0x004f, 0x004b, 0x0047,
    0x0042, 0x003f, 0x003b, 0x0038, 0x0035, 0x0032, 0x002f, 0x002c, 0x002a, 0x0027, 0x0025, 0x0023, 0x0021, 0x001f,
    0x001d, 0x001c, 0x001a, 0x0019, 0x0017, 0x0016, 0x0015, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f,
  ],
  asm33: [
    0x0d3e, 0x0c80, 0x0bcc, 0x0b22, 0x0a82, 0x09ec, 0x095c, 0x08d6, 0x0858, 0x07e0, 0x076e, 0x0704, 0x069f, 0x0640,
    0x05e6, 0x0591, 0x0541, 0x04f6, 0x04ae, 0x046b, 0x042c, 0x03f0, 0x03b7, 0x0382, 0x034f, 0x0320, 0x02f3, 0x02c8,
    0x02a1, 0x027b, 0x0257, 0x0236, 0x0216, 0x01f8, 0x01dc, 0x01c1, 0x01a8, 0x0190, 0x0179, 0x0164, 0x0150, 0x013d,
    0x012c, 0x011b, 0x010b, 0x00fc, 0x00ee, 0x00e0, 0x00d4, 0x00c8, 0x00bd, 0x00b2, 0x00a8, 0x009f, 0x0096, 0x008d,
    0x0085, 0x007e, 0x0077, 0x0070, 0x006a, 0x0064, 0x005e, 0x0059, 0x0054, 0x0050, 0x004b, 0x0047, 0x0043, 0x003f,
    0x003c, 0x0038, 0x0035, 0x0032, 0x002f, 0x002d, 0x002a, 0x0028, 0x0026, 0x0024, 0x0022, 0x0020, 0x001e, 0x001d,
    0x001b, 0x001a, 0x0019, 0x0018, 0x0015, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e,
  ],
  asm34: [
    0x0d10, 0x0c55, 0x0ba4, 0x0afc, 0x0a5f, 0x09ca, 0x093d, 0x08b8, 0x083b, 0x07c5, 0x0755, 0x06ec, 0x0688, 0x062a,
    0x05d2, 0x057e, 0x052f, 0x04e5, 0x049e, 0x045c, 0x041d, 0x03e2, 0x03ab, 0x0376, 0x0344, 0x0315, 0x02e9, 0x02bf,
    0x0298, 0x0272, 0x024f, 0x022e, 0x020f, 0x01f1, 0x01d5, 0x01bb, 0x01a2, 0x018b, 0x0174, 0x0160, 0x014c, 0x0139,
    0x0128, 0x0117, 0x0107, 0x00f9, 0x00eb, 0x00dd, 0x00d1, 0x00c5, 0x00ba, 0x00b0, 0x00a6, 0x009d, 0x0094, 0x008c,
    0x0084, 0x007c, 0x0075, 0x006f, 0x0069, 0x0063, 0x005d, 0x0058, 0x0053, 0x004e, 0x004a, 0x0046, 0x0042, 0x003e,
    0x003b, 0x0037, 0x0034, 0x0031, 0x002f, 0x002c, 0x0029, 0x0027, 0x0025, 0x0023, 0x0021, 0x001f, 0x001d, 0x001c,
    0x001a, 0x0019, 0x0017, 0x0016, 0x0015, 0x0014, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d,
  ],
  real33: [
    0x0cda, 0x0c22, 0x0b73, 0x0acf, 0x0a33, 0x09a1, 0x0917, 0x0894, 0x0819, 0x07a4, 0x0737, 0x06cf, 0x066d, 0x0611,
    0x05ba, 0x0567, 0x051a, 0x04d0, 0x048b, 0x044a, 0x040c, 0x03d2, 0x039b, 0x0367, 0x0337, 0x0308, 0x02dd, 0x02b4,
    0x028d, 0x0268, 0x0246, 0x0225, 0x0206, 0x01e9, 0x01ce, 0x01b4, 0x019b, 0x0184, 0x016e, 0x015a, 0x0146, 0x0134,
    0x0123, 0x0113, 0x0103, 0x00f5, 0x00e7, 0x00da, 0x00ce, 0x00c2, 0x00b7, 0x00ad, 0x00a3, 0x009a, 0x0091, 0x0089,
    0x0082, 0x007a, 0x0073, 0x006d, 0x0067, 0x0061, 0x005c, 0x0056, 0x0052, 0x004d, 0x0049, 0x0045, 0x0041, 0x003d,
    0x003a, 0x0036, 0x0033, 0x0031, 0x002e, 0x002b, 0x0029, 0x0027, 0x0024, 0x0022, 0x0020, 0x001f, 0x001d, 0x001b,
    0x001a, 0x0018, 0x0017, 0x0016, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d,
  ],
  real34: [
    0x0cda, 0x0c22, 0x0b73, 0x0acf, 0x0a33, 0x09a1, 0x0917, 0x0894, 0x0819, 0x07a4, 0x0737, 0x06cf, 0x066d, 0x0611,
    0x05ba, 0x0567, 0x051a, 0x04d0, 0x048b, 0x044a, 0x040c, 0x03d2, 0x039b, 0x0367, 0x0337, 0x0308, 0x02dd, 0x02b4,
    0x028d, 0x0268, 0x0246, 0x0225, 0x0206, 0x01e9, 0x01ce, 0x01b4, 0x019b, 0x0184, 0x016e, 0x015a, 0x0146, 0x0134,
    0x0123, 0x0112, 0x0103, 0x00f5, 0x00e7, 0x00da, 0x00ce, 0x00c2, 0x00b7, 0x00ad, 0x00a3, 0x009a, 0x0091, 0x0089,
    0x0082, 0x007a, 0x0073, 0x006d, 0x0067, 0x0061, 0x005c, 0x0056, 0x0052, 0x004d, 0x0049, 0x0045, 0x0041, 0x003d,
    0x003a, 0x0036, 0x0033, 0x0031, 0x002e, 0x002b, 0x0029, 0x0027, 0x0024, 0x0022, 0x0020, 0x001f, 0x001d, 0x001b,
    0x001a, 0x0018, 0x0017, 0x0016, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d,
  ],
  natural: [
    2880, 2700, 2560, 2400, 2304, 2160, 2025, 1920, 1800, 1728, 1620, 1536, 1440, 1350, 1280, 1200, 1152, 1080, 1013,
    960, 900, 864, 810, 768, 720, 675, 640, 600, 576, 540, 506, 480, 450, 432, 405, 384, 360, 338, 320, 300, 288, 270,
    253, 240, 225, 216, 203, 192, 180, 169, 160, 150, 144, 135, 127, 120, 113, 108, 101, 96, 90, 84, 80, 75, 72, 68, 63,
    60, 56, 54, 51, 48, 45, 42, 40, 38, 36, 34, 32, 30, 28, 27, 25, 24, 23, 21, 20, 19, 18, 17, 16, 15, 14, 14, 13, 12,
  ],
};

async function main() {
  const files = await findPT3Files(songsDirectory);
  if (files.length === 0) {
    console.log('Nenašli sa žiadne .pt3 súbory v songs/.');
    return;
  }

  const modules = [];
  for (const file of files) {
    const input = path.join(songsDirectory, file);
    const data = await readFile(input);
    modules.push({ file, module: parsePT3(data, file) });
  }
  const outputNames = makeUniqueOutputNames(modules);
  if (!dryRun) {
    await mkdir(generatedDirectory, { recursive: true });
  }

  for (const { file, module } of modules) {
    const plannedName = outputNames.get(file);
    const output = path.join(generatedDirectory, plannedName);

    if (dryRun) {
      console.log(`${file} -> songs/generated/${plannedName}`);
      continue;
    }

    const render = renderPT3(module);
    if (render.usedGuard) {
      console.warn(`${file}: render zastavený guardom ${MAX_FRAMES} framov; loop/end sa nedal spoľahlivo uzavrieť.`);
    }
    await writeFile(output, buildPSG(render.frames));
    console.log(`${file} -> songs/generated/${plannedName} (${render.frames.length} framov)`);
  }
}

async function findPT3Files(directory, prefix = '') {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      if (relative === 'generated') continue;
      files.push(...(await findPT3Files(directory, relative)));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pt3') {
      files.push(relative);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function makeUniqueOutputNames(modules) {
  const used = new Map();
  const result = new Map();
  for (const { file, module } of modules) {
    const base = outputBaseName(module, file);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    result.set(file, `${base}${count === 1 ? '' : `-${String(count).padStart(2, '0')}`}.psg`);
  }
  return result;
}

function outputBaseName(module, sourceFile) {
  const title = sanitizeFilename(module.meta.title);
  const artist = sanitizeFilename(module.meta.artist);
  if (title && artist) return `${artist} - ${title}`;
  if (title) return title;
  return sanitizeFilename(path.basename(sourceFile, path.extname(sourceFile))) || 'song';
}

function sanitizeFilename(value) {
  return String(value ?? '')
    .replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePT3(data, sourceFile) {
  if (data.length < 202 || ascii(data, 0, 13) !== 'ProTracker 3.') {
    throw new Error(`${sourceFile}: nie je podporovaný ProTracker 3.x compiled PT3.`);
  }

  const versionByte = data[13];
  const version = versionByte >= 0x30 && versionByte <= 0x39 ? versionByte - 0x30 : 6;
  const mode = data[98];
  if (mode !== SINGLE_AY_MODE) {
    console.warn(`${sourceFile}: TurboSound PT3 mode ${mode} nie je vo v1 podporený; renderujem prvý AY pattern set.`);
  }

  const noteTable =
    data[99] >= NOTE_TABLE.PROTRACKER && data[99] <= NOTE_TABLE.NATURAL ? data[99] : NOTE_TABLE.PROTRACKER;
  const tempo = data[100];
  if (tempo < 1) throw new Error(`${sourceFile}: neplatné tempo ${tempo}.`);

  const loop = data[102];
  const patternsOffset = readUInt16LE(data, 103);
  if (patternsOffset <= 0 || patternsOffset >= data.length) {
    throw new Error(`${sourceFile}: neplatný patterns offset 0x${patternsOffset.toString(16)}.`);
  }

  const sampleOffsets = Array.from({ length: 32 }, (_, index) => readUInt16LE(data, 105 + index * 2));
  const ornamentOffsets = Array.from({ length: 16 }, (_, index) => readUInt16LE(data, 169 + index * 2));
  const positions = readPositions(data, 201, sourceFile);
  if (positions.length === 0) throw new Error(`${sourceFile}: prázdny order list.`);

  const meta = readMetadata(data);
  const usedPatterns = new Set(positions);
  const patterns = parsePatterns(data, patternsOffset, usedPatterns);
  const usedSamples = new Set([DEFAULT_SAMPLE]);
  const usedOrnaments = new Set([DEFAULT_ORNAMENT]);

  for (const pattern of patterns.values()) {
    for (const line of pattern.lines) {
      if (!line) continue;
      for (const cell of line.channels) {
        if (!cell) continue;
        if (cell.sample !== undefined) usedSamples.add(cell.sample);
        if (cell.ornament !== undefined) usedOrnaments.add(cell.ornament);
      }
    }
  }

  const samples = [];
  for (const index of usedSamples) {
    samples[index] = sampleOffsets[index] ? parseSample(data, sampleOffsets[index]) : defaultSample();
  }
  if (!samples[DEFAULT_SAMPLE]) samples[DEFAULT_SAMPLE] = defaultSample();

  const ornaments = [];
  for (const index of usedOrnaments) {
    ornaments[index] = ornamentOffsets[index] ? parseOrnament(data, ornamentOffsets[index]) : defaultOrnament();
  }
  if (!ornaments[DEFAULT_ORNAMENT]) ornaments[DEFAULT_ORNAMENT] = defaultOrnament();

  return {
    sourceFile,
    meta,
    version,
    noteTable,
    initialTempo: tempo,
    loop: Math.min(loop, positions.length - 1),
    positions,
    patterns,
    samples,
    ornaments,
    frequencyTable: selectFrequencyTable(noteTable, version),
  };
}

function readMetadata(data) {
  const optional = ascii(data, 62, 4).trim().toLowerCase();
  if (optional === 'by') {
    return {
      title: ascii(data, 30, 32).trim(),
      artist: ascii(data, 66, 32).trim(),
    };
  }
  return {
    title: ascii(data, 30, 68).trim(),
    artist: '',
  };
}

function readPositions(data, offset, sourceFile) {
  const positions = [];
  for (let cursor = offset; cursor < data.length && cursor < offset + 256; cursor += 1) {
    const value = data[cursor];
    if (value === POSITION_END) return positions;
    if (value % 3 !== 0) throw new Error(`${sourceFile}: neplatná position hodnota ${value} na offsete ${cursor}.`);
    positions.push(value / 3);
  }
  throw new Error(`${sourceFile}: order list nie je ukončený 0xff.`);
}

function parsePatterns(data, patternsOffset, usedPatterns) {
  const patterns = new Map();
  const maxPattern = Math.max(...usedPatterns);
  const minChannelOffset = patternsOffset + maxPattern * 6;

  for (const patternIndex of [...usedPatterns].sort((left, right) => left - right)) {
    const patternTableOffset = patternsOffset + patternIndex * 6;
    ensureRange(data, patternTableOffset, 6, `pattern ${patternIndex}`);
    const channelOffsets = [0, 1, 2].map((channel) => readUInt16LE(data, patternTableOffset + channel * 2));
    if (channelOffsets.some((offset) => offset < minChannelOffset || offset >= data.length)) {
      throw new Error(`pattern ${patternIndex}: neplatný channel offset.`);
    }
    patterns.set(patternIndex, parsePattern(data, channelOffsets));
  }

  return patterns;
}

function parsePattern(data, channelOffsets) {
  const channels = channelOffsets.map((offset) => ({ offset, period: 0, counter: 0 }));
  const lines = [];
  let size = 1;

  for (let lineIndex = 0; lineIndex < 256; lineIndex += 1) {
    const skip = Math.min(...channels.map((channel) => channel.counter));
    if (skip > 0) {
      for (const channel of channels) channel.counter -= skip;
      lineIndex += skip;
    }

    if (!hasPatternLine(data, channels)) {
      size = Math.max(lineIndex, 1);
      break;
    }

    const line = { tempo: 0, channels: Array.from({ length: CHANNELS }, () => null) };
    for (let channelIndex = 0; channelIndex < CHANNELS; channelIndex += 1) {
      const channel = channels[channelIndex];
      if (channel.counter > 0) {
        channel.counter -= 1;
        continue;
      }
      line.channels[channelIndex] = parseChannel(data, channel, line);
      channel.counter = channel.period;
    }
    lines[lineIndex] = line;
    size = lineIndex + 1;
  }

  return { size, lines };
}

function hasPatternLine(data, channels) {
  for (let channelIndex = 0; channelIndex < CHANNELS; channelIndex += 1) {
    const channel = channels[channelIndex];
    if (channel.counter > 0) continue;
    if (channel.offset >= data.length || (channelIndex === 0 && data[channel.offset] === 0x00)) return false;
  }
  return true;
}

function parseChannel(data, state, line) {
  const cell = { commands: [] };
  const deferred = [];
  let note = -1;

  while (state.offset < data.length) {
    const cmd = data[state.offset++];
    if (cmd < 0x10) {
      deferred.push(cmd);
    } else if (cmd < 0x20 || (cmd >= 0xb2 && cmd <= 0xbf) || cmd >= 0xf0) {
      const hasEnvelope = cmd >= 0x11 && cmd <= 0xbf;
      const hasOrnament = cmd >= 0xf0;
      const hasSample = cmd < 0xb2 || cmd > 0xbf;

      if (hasEnvelope) {
        const type = cmd - (cmd >= 0xb2 ? 0xb1 : 0x10);
        const tone = readUInt16BE(data, state.offset);
        state.offset += 2;
        cell.commands.push({ type: COMMAND.ENVELOPE, p1: type, p2: tone });
      } else {
        cell.commands.push({ type: COMMAND.NO_ENVELOPE });
      }
      if (hasOrnament) cell.ornament = cmd - 0xf0;
      if (hasSample) {
        const doubleSample = data[state.offset++];
        cell.sample = doubleSample < 64 && (doubleSample & 1) === 0 ? doubleSample / 2 : 0;
      }
    } else if (cmd < 0x40) {
      cell.commands.push({ type: COMMAND.NOISE_BASE, p1: cmd - 0x20 });
    } else if (cmd < 0x50) {
      cell.ornament = cmd - 0x40;
    } else if (cmd < 0xb0) {
      note = cmd - 0x50;
      break;
    } else if (cmd === 0xb0) {
      cell.commands.push({ type: COMMAND.NO_ENVELOPE });
    } else if (cmd === 0xb1) {
      state.period = (data[state.offset++] - 1) & 0xff;
    } else if (cmd === 0xc0) {
      cell.enabled = false;
      break;
    } else if (cmd < 0xd0) {
      cell.volume = cmd - 0xc0;
    } else if (cmd === 0xd0) {
      break;
    } else if (cmd < 0xf0) {
      cell.sample = cmd - 0xd0;
    }
  }

  for (let index = deferred.length - 1; index >= 0; index -= 1) {
    const command = deferred[index];
    switch (command) {
      case 1:
        cell.commands.push({ type: COMMAND.GLISS, p1: data[state.offset++], p2: readInt16LE(data, state.offset) });
        state.offset += 2;
        break;
      case 2:
        cell.commands.push({
          type: COMMAND.GLISS_NOTE,
          p1: data[state.offset++],
          p2: readInt16LE(data, state.offset + 2),
          p3: 0,
        });
        state.offset += 4;
        break;
      case 3:
        cell.commands.push({ type: COMMAND.SAMPLE_OFFSET, p1: data[state.offset++] });
        break;
      case 4:
        cell.commands.push({ type: COMMAND.ORNAMENT_OFFSET, p1: data[state.offset++] });
        break;
      case 5:
        cell.commands.push({ type: COMMAND.VIBRATE, p1: data[state.offset++], p2: data[state.offset++] });
        break;
      case 8:
        cell.commands.push({ type: COMMAND.SLIDE_ENV, p1: data[state.offset++], p2: readInt16LE(data, state.offset) });
        state.offset += 2;
        break;
      case 9:
        line.tempo = data[state.offset++];
        break;
      default:
        break;
    }
  }

  if (note !== -1) {
    const glissNote = cell.commands.find((command) => command.type === COMMAND.GLISS_NOTE);
    if (glissNote) {
      glissNote.p3 = note;
    } else {
      cell.note = note;
    }
    if (cell.enabled === undefined) cell.enabled = true;
  }

  return hasCellData(cell) ? cell : null;
}

function hasCellData(cell) {
  return (
    cell.enabled !== undefined ||
    cell.note !== undefined ||
    cell.sample !== undefined ||
    cell.ornament !== undefined ||
    cell.volume !== undefined ||
    cell.commands.length > 0
  );
}

function parseSample(data, offset) {
  ensureRange(data, offset, 2, `sample 0x${offset.toString(16)}`);
  const loop = data[offset];
  const size = data[offset + 1] || 1;
  const availableLines = Math.max(0, Math.floor((data.length - offset - 2) / 4));
  const physicalLines = Math.min(size, availableLines, 64);
  const lines = [];

  for (let index = 0; index < physicalLines; index += 1) {
    const lineOffset = offset + 2 + index * 4;
    const volSlideEnv = data[lineOffset];
    const levelKeepers = data[lineOffset + 1];
    const noiseOrEnvelope = (volSlideEnv & 0x3e) >> 1;
    lines.push({
      level: levelKeepers & 0x0f,
      volumeSlideAddon: volSlideEnv & 0x80 ? (volSlideEnv & 0x40 ? 1 : -1) : 0,
      toneMask: Boolean(levelKeepers & 0x10),
      toneOffset: readInt16LE(data, lineOffset + 2),
      keepToneOffset: Boolean(levelKeepers & 0x40),
      noiseMask: Boolean(levelKeepers & 0x80),
      envMask: Boolean(volSlideEnv & 0x01),
      noiseOrEnvelopeOffset: noiseOrEnvelope & 0x10 ? noiseOrEnvelope | -0x20 : noiseOrEnvelope,
      keepNoiseOrEnvelopeOffset: Boolean(levelKeepers & 0x20),
    });
  }

  return {
    lines: lines.length > 0 ? lines : defaultSample().lines,
    loop: Math.min(loop, Math.max(lines.length - 1, 0)),
  };
}

function parseOrnament(data, offset) {
  ensureRange(data, offset, 2, `ornament 0x${offset.toString(16)}`);
  const loop = data[offset];
  const size = data[offset + 1] || 1;
  const lines = [];
  for (let index = 0; index < size && offset + 2 + index < data.length; index += 1) {
    lines.push(readInt8(data[offset + 2 + index]));
  }
  return {
    lines: lines.length > 0 ? lines : [0],
    loop: Math.min(loop, Math.max(lines.length - 1, 0)),
  };
}

function defaultSample() {
  return {
    lines: [
      {
        level: 0,
        volumeSlideAddon: 0,
        toneMask: false,
        toneOffset: 0,
        keepToneOffset: false,
        noiseMask: true,
        envMask: false,
        noiseOrEnvelopeOffset: 0,
        keepNoiseOrEnvelopeOffset: false,
      },
    ],
    loop: 0,
  };
}

function defaultOrnament() {
  return { lines: [0], loop: 0 };
}

function renderPT3(module) {
  const cursor = new TrackCursor(module);
  const renderer = new VortexRenderer(module);
  const writer = new PSGFrameWriter();
  const frames = [];
  let usedGuard = true;

  for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
    const { regs, touched } = renderer.synthesize(cursor.state);
    frames.push(writer.writeFrame(regs, touched));
    cursor.nextFrame();
    if (cursor.loopCount > 0) {
      usedGuard = false;
      break;
    }
  }

  return { frames, usedGuard };
}

class TrackCursor {
  constructor(module) {
    this.module = module;
    this.frame = 0;
    this.position = 0;
    this.patternIndex = module.positions[0];
    this.line = 0;
    this.quirk = 0;
    this.tempo = module.initialTempo;
    this.loopCount = 0;
    this.refreshLineTempo();
  }

  get state() {
    return {
      position: this.position,
      patternIndex: this.patternIndex,
      line: this.line,
      quirk: this.quirk,
      lineObject: this.currentPattern().lines[this.line] ?? null,
    };
  }

  nextFrame() {
    this.frame += 1;
    this.quirk += 1;
    if (this.quirk < this.tempo) return;

    this.setLine(this.line + 1);
    if (this.line < this.currentPattern().size) return;

    this.position += 1;
    if (this.position < this.module.positions.length) {
      this.patternIndex = this.module.positions[this.position];
      this.setLine(0);
      return;
    }

    this.loopCount += 1;
    this.position = this.module.loop;
    this.patternIndex = this.module.positions[this.position] ?? this.module.positions[0];
    this.setLine(0);
  }

  setLine(line) {
    this.line = line;
    this.quirk = 0;
    this.refreshLineTempo();
  }

  refreshLineTempo() {
    const tempo = this.currentPattern().lines[this.line]?.tempo ?? 0;
    if (tempo > 0) this.tempo = tempo;
  }

  currentPattern() {
    return this.module.patterns.get(this.patternIndex) ?? { size: 1, lines: [] };
  }
}

class VortexRenderer {
  constructor(module) {
    this.module = module;
    this.channels = Array.from({ length: CHANNELS }, () => new ChannelState());
    this.common = {
      envBase: 0,
      envSlider: new Slider(),
      noiseBase: 0,
      noiseAddon: 0,
    };
  }

  synthesize(state) {
    const track = new TrackBuilder(this.module.frequencyTable);
    if (state.quirk === 0) {
      if (state.line === 0) this.common.noiseBase = 0;
      if (state.lineObject) {
        for (let index = 0; index < CHANNELS; index += 1) {
          const cell = state.lineObject.channels[index];
          if (cell) this.applyCell(cell, this.channels[index], track);
        }
      }
    }
    this.synthesizeChannels(track);
    return { regs: track.regs, touched: track.touched };
  }

  applyCell(cell, channel, track) {
    const previousSlide = channel.toneSlider.value;
    if (cell.enabled !== undefined) {
      channel.posInSample = 0;
      channel.posInOrnament = 0;
      channel.volSlide = 0;
      channel.envSliding = 0;
      channel.noiseSliding = 0;
      channel.toneSlider.reset();
      channel.toneAccumulator = 0;
      channel.vibrateCounter = 0;
      channel.enabled = cell.enabled;
    }
    if (cell.note !== undefined) channel.note = cell.note;
    if (cell.sample !== undefined) channel.sampleNum = cell.sample;
    if (cell.ornament !== undefined) {
      channel.ornamentNum = cell.ornament;
      channel.posInOrnament = 0;
    }
    if (cell.volume !== undefined) channel.volume = cell.volume;

    for (const command of cell.commands) {
      switch (command.type) {
        case COMMAND.GLISS:
          channel.toneSlider.period = command.p1;
          channel.toneSlider.counter = command.p1;
          channel.toneSlider.delta = command.p2;
          channel.slidingTargetNote = LIMITER;
          channel.vibrateCounter = 0;
          if (channel.toneSlider.counter === 0 && this.module.version >= 7) channel.toneSlider.counter += 1;
          break;
        case COMMAND.GLISS_NOTE:
          channel.vibrateCounter = 0;
          channel.toneSlider.period = command.p1;
          channel.toneSlider.counter = command.p1;
          channel.toneSlider.delta = Math.abs(command.p2);
          channel.slidingTargetNote = command.p3;
          channel.slidingDelta = track.getSlidingDifference(channel.note, channel.slidingTargetNote);
          if (this.module.version >= 6) channel.toneSlider.value = previousSlide;
          if (channel.slidingDelta - channel.toneSlider.value < 0) channel.toneSlider.delta = -channel.toneSlider.delta;
          break;
        case COMMAND.SAMPLE_OFFSET:
          channel.posInSample = command.p1;
          break;
        case COMMAND.ORNAMENT_OFFSET:
          channel.posInOrnament = command.p1;
          break;
        case COMMAND.VIBRATE:
          channel.vibrateCounter = command.p1;
          channel.vibrateOn = command.p1;
          channel.vibrateOff = command.p2;
          channel.toneSlider.value = 0;
          channel.toneSlider.counter = 0;
          break;
        case COMMAND.SLIDE_ENV:
          this.common.envSlider.period = command.p1;
          this.common.envSlider.counter = command.p1;
          this.common.envSlider.delta = command.p2;
          break;
        case COMMAND.ENVELOPE:
          track.setEnvelopeType(command.p1);
          this.common.envBase = command.p2;
          channel.envelope = true;
          this.common.envSlider.reset();
          channel.posInOrnament = 0;
          break;
        case COMMAND.NO_ENVELOPE:
          channel.envelope = false;
          channel.posInOrnament = 0;
          break;
        case COMMAND.NOISE_BASE:
          this.common.noiseBase = command.p1;
          break;
        default:
          break;
      }
    }
  }

  synthesizeChannels(track) {
    let envelopeAddon = 0;
    for (let index = 0; index < CHANNELS; index += 1) {
      this.synthesizeChannel(this.channels[index], track.channel(index), (addon) => {
        envelopeAddon += addon;
      });
      const channel = this.channels[index];
      if (channel.vibrateCounter > 0) {
        channel.vibrateCounter -= 1;
        if (channel.vibrateCounter === 0) {
          channel.enabled = !channel.enabled;
          channel.vibrateCounter = channel.enabled ? channel.vibrateOn : channel.vibrateOff;
        }
      }
    }
    track.setNoise(this.common.noiseBase + this.common.noiseAddon);
    track.setEnvelopeTone(envelopeAddon + this.common.envSlider.value + this.common.envBase);
    this.common.envSlider.update();
  }

  synthesizeChannel(state, channel, addEnvelope) {
    if (!state.enabled) {
      channel.setLevel(0);
      return;
    }

    const sample = this.module.samples[state.sampleNum] ?? defaultSample();
    const sampleLine = getLoopedLine(sample, state.posInSample);
    const ornament = this.module.ornaments[state.ornamentNum] ?? defaultOrnament();
    const toneAddon = sampleLine.toneOffset + state.toneAccumulator;
    if (sampleLine.keepToneOffset) state.toneAccumulator = toneAddon;

    const halfTones = state.note + getLoopedLine(ornament, state.posInOrnament);
    channel.setTone(halfTones, state.toneSlider.value + toneAddon);
    if (sampleLine.toneMask) channel.disableTone();

    state.volSlide = clamp(state.volSlide + sampleLine.volumeSlideAddon, -15, 15);
    channel.setLevel(getVolume(state.volume, clamp(state.volSlide + sampleLine.level, 0, 15)));

    if (state.envelope && !sampleLine.envMask) channel.enableEnvelope();

    if (sampleLine.noiseMask) {
      const envAddon = sampleLine.noiseOrEnvelopeOffset + state.envSliding;
      if (sampleLine.keepNoiseOrEnvelopeOffset) state.envSliding = envAddon;
      addEnvelope(envAddon);
      channel.disableNoise();
    } else {
      this.common.noiseAddon = sampleLine.noiseOrEnvelopeOffset + state.noiseSliding;
      if (sampleLine.keepNoiseOrEnvelopeOffset) state.noiseSliding = this.common.noiseAddon;
    }

    if (state.toneSlider.update() && state.slidingTargetNote !== LIMITER) {
      const reachedFromBelow = state.toneSlider.delta >= 0 && state.toneSlider.value >= state.slidingDelta;
      const reachedFromAbove = state.toneSlider.delta < 0 && state.toneSlider.value <= state.slidingDelta;
      if (reachedFromBelow || reachedFromAbove) {
        state.note = state.slidingTargetNote;
        state.toneSlider.value = 0;
        state.toneSlider.counter = 0;
      }
    }

    state.posInSample = nextLoopedPosition(sample, state.posInSample);
    state.posInOrnament = nextLoopedPosition(ornament, state.posInOrnament);
  }
}

class ChannelState {
  constructor() {
    this.enabled = false;
    this.envelope = false;
    this.note = 0;
    this.sampleNum = DEFAULT_SAMPLE;
    this.posInSample = 0;
    this.ornamentNum = DEFAULT_ORNAMENT;
    this.posInOrnament = 0;
    this.volume = 15;
    this.volSlide = 0;
    this.toneSlider = new Slider();
    this.slidingTargetNote = LIMITER;
    this.slidingDelta = 0;
    this.toneAccumulator = 0;
    this.envSliding = 0;
    this.noiseSliding = 0;
    this.vibrateCounter = 0;
    this.vibrateOn = 0;
    this.vibrateOff = 0;
  }
}

class Slider {
  constructor() {
    this.period = 0;
    this.value = 0;
    this.counter = 0;
    this.delta = 0;
  }

  update() {
    if (this.counter > 0) {
      this.counter -= 1;
      if (this.counter === 0) {
        this.value += this.delta;
        this.counter = this.period;
        return true;
      }
    }
    return false;
  }

  reset() {
    this.counter = 0;
    this.value = 0;
  }
}

class TrackBuilder {
  constructor(table) {
    this.table = table;
    this.regs = new Uint8Array(14);
    this.touched = new Set();
    this.regs[7] = 0;
  }

  channel(index) {
    return new ChannelBuilder(index, this.table, this);
  }

  setNoise(level) {
    this.regs[6] = level & 0x1f;
  }

  setEnvelopeType(type) {
    this.regs[13] = type & 0xff;
    this.touched.add(13);
  }

  setEnvelopeTone(tone) {
    this.regs[11] = tone & 0xff;
    this.regs[12] = (tone >> 8) & 0xff;
  }

  getSlidingDifference(from, to) {
    const toneFrom = this.table[clamp(from, 0, this.table.length - 1)];
    const toneTo = this.table[clamp(to, 0, this.table.length - 1)];
    return toneTo - toneFrom;
  }
}

class ChannelBuilder {
  constructor(index, table, track) {
    this.index = index;
    this.table = table;
    this.track = track;
  }

  setTone(halfTones, offset) {
    const note = clamp(halfTones, 0, this.table.length - 1);
    this.setTonePeriod((this.table[note] + offset) & 0x0fff);
  }

  setTonePeriod(tone) {
    const reg = this.index * 2;
    this.track.regs[reg] = tone & 0xff;
    this.track.regs[reg + 1] = (tone >> 8) & 0x0f;
  }

  setLevel(level) {
    this.track.regs[8 + this.index] = clamp(level, 0, 15);
  }

  disableTone() {
    this.track.regs[7] |= 1 << this.index;
  }

  enableEnvelope() {
    this.track.regs[8 + this.index] |= 0x10;
  }

  disableNoise() {
    this.track.regs[7] |= 0x08 << this.index;
  }
}

class PSGFrameWriter {
  constructor() {
    this.previous = new Uint8Array(14);
  }

  writeFrame(regs, touched) {
    const writes = [];
    for (let register = 0; register < 14; register += 1) {
      if (register === 13) {
        if (!touched.has(13)) continue;
      } else if (regs[register] === this.previous[register]) {
        continue;
      }
      writes.push(register, regs[register]);
      this.previous[register] = regs[register];
    }
    return writes;
  }
}

function buildPSG(frames) {
  const chunks = [Buffer.alloc(PSG_HEADER_SIZE)];
  chunks[0].write('PSG\x1a', 0, 'binary');
  for (const frame of frames) {
    chunks.push(Buffer.from([0xff, ...frame]));
  }
  chunks.push(Buffer.from([0xfd]));
  return Buffer.concat(chunks);
}

function selectFrequencyTable(noteTable, version) {
  switch (noteTable) {
    case NOTE_TABLE.SOUNDTRACKER:
      return FREQUENCY_TABLES.soundtracker;
    case NOTE_TABLE.ASM:
      return version <= 3 ? FREQUENCY_TABLES.asm33 : FREQUENCY_TABLES.asm34;
    case NOTE_TABLE.REAL:
      return version <= 3 ? FREQUENCY_TABLES.real33 : FREQUENCY_TABLES.real34;
    case NOTE_TABLE.NATURAL:
      return FREQUENCY_TABLES.natural;
    case NOTE_TABLE.PROTRACKER:
    default:
      return version <= 3 ? FREQUENCY_TABLES.protracker33 : FREQUENCY_TABLES.protracker34;
  }
}

function getLoopedLine(sequence, position) {
  if (sequence.lines.length === 0) return 0;
  return sequence.lines[position % sequence.lines.length];
}

function nextLoopedPosition(sequence, position) {
  const next = position + 1;
  return next >= sequence.lines.length ? sequence.loop : next;
}

function getVolume(volume, level) {
  return Math.round((clamp(volume, 0, 15) * clamp(level, 0, 15)) / 15);
}

function ensureRange(data, offset, size, label) {
  if (offset < 0 || offset + size > data.length) throw new Error(`${label}: neočakávaný koniec súboru.`);
}

function ascii(data, offset, length) {
  return Buffer.from(data.subarray(offset, offset + length))
    .toString('latin1')
    .replace(/\0/g, '');
}

function readUInt16LE(data, offset) {
  ensureRange(data, offset, 2, `uint16le 0x${offset.toString(16)}`);
  return data[offset] | (data[offset + 1] << 8);
}

function readUInt16BE(data, offset) {
  ensureRange(data, offset, 2, `uint16be 0x${offset.toString(16)}`);
  return (data[offset] << 8) | data[offset + 1];
}

function readInt16LE(data, offset) {
  const value = readUInt16LE(data, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readInt8(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

await main();
