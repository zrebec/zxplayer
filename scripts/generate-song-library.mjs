import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSupportedSongFile, metadataSidecarCandidates, normalizeCatalog } from './song-catalog-metadata.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const songsDirectory = path.join(projectDirectory, 'songs');
const catalogFile = path.join(songsDirectory, 'index.json');
const SUPPORTED_SCHEMA_VERSION = 1;

const songFiles = await findSongFiles();

const songs = [];
for (const file of songFiles) {
  const fullPath = path.join(songsDirectory, file);
  const type = getSongType(file);

  if (type !== 'json') {
    const sidecar = await readMetadataSidecar(file);
    const filenameMeta = metadataFromPSGFilename(file);
    const machine = sidecar?.machine ?? 'melodik';
    songs.push({
      id: sidecar?.id ?? slugFromFile(file),
      title: sidecar?.title ?? filenameMeta.title,
      ...((sidecar?.artist ?? filenameMeta.artist) ? { artist: sidecar?.artist ?? filenameMeta.artist } : {}),
      file,
      type,
      machine,
      loop: sidecar?.loop ?? true,
      catalog: normalizeCatalog(sidecar?.catalog, { type, machine }),
    });
    continue;
  }

  const parsed = JSON.parse(await readFile(fullPath, 'utf8'));

  if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${file}: nepodporovaná schemaVersion ${parsed.schemaVersion ?? 'chýba'} (očakávam ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }

  if (!parsed.id || !parsed.title || (!parsed.channels && !parsed.effect)) {
    throw new Error(`${file}: očakávam id, title a channels (alebo effect).`);
  }

  songs.push({
    id: parsed.id,
    title: parsed.title,
    ...(parsed.artist ? { artist: parsed.artist } : {}),
    file,
    type,
    catalog: normalizeCatalog(parsed.catalog, {
      type,
      effect: Boolean(parsed.effect),
    }),
  });
}

songs.sort((left, right) => left.title.localeCompare(right.title, 'sk'));
await mkdir(songsDirectory, { recursive: true });
await writeFile(catalogFile, `${JSON.stringify({ songs }, null, 2)}\n`, 'utf8');
console.log(`Vygenerovaný songs/index.json: ${songs.length} skladba(y).`);

async function findSongFiles() {
  const rootEntries = await readdir(songsDirectory, { withFileTypes: true });
  const rootFiles = rootEntries
    .filter((entry) => entry.isFile() && isSupportedSongFile(entry.name))
    .map((entry) => entry.name);

  const generatedPath = path.join(songsDirectory, 'generated');
  let generatedFiles = [];
  try {
    const generatedEntries = await readdir(generatedPath, { withFileTypes: true });
    generatedFiles = generatedEntries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.psg')
      .map((entry) => path.join('generated', entry.name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return [...rootFiles, ...generatedFiles].sort((left, right) => left.localeCompare(right));
}

function getSongType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.psg') return 'psg';
  return 'json';
}

async function readMetadataSidecar(file) {
  for (const candidate of metadataSidecarCandidates(file)) {
    try {
      const metadata = JSON.parse(await readFile(path.join(songsDirectory, candidate), 'utf8'));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new TypeError('metadata sidecar musí obsahovať JSON objekt');
      }
      return metadata;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`${candidate}: neplatný PSG metadata sidecar.`, { cause: error });
    }
  }

  return undefined;
}

function slugFromFile(file) {
  const extension = path.extname(file);
  const base = file.slice(0, file.length - extension.length);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function metadataFromPSGFilename(file) {
  const title = path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').trim();
  const separator = title.indexOf(' - ');
  if (separator === -1) return { title };
  return {
    artist: title.slice(0, separator).trim(),
    title: title.slice(separator + 3).trim(),
  };
}
