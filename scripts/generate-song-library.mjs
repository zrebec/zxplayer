import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const songsDirectory = path.join(projectDirectory, 'songs');
const catalogFile = path.join(songsDirectory, 'index.json');
const SUPPORTED_SCHEMA_VERSION = 1;

const songFiles = (await readdir(songsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const songs = [];
for (const file of songFiles) {
  const fullPath = path.join(songsDirectory, file);
  const parsed = JSON.parse(await readFile(fullPath, 'utf8'));

  if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${file}: nepodporovaná schemaVersion ${parsed.schemaVersion ?? 'chýba'} (očakávam ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }

  if (!parsed.id || !parsed.title || !parsed.channels) {
    throw new Error(`${file}: očakávam id, title a channels.`);
  }

  songs.push({
    id: parsed.id,
    title: parsed.title,
    ...(parsed.artist ? { artist: parsed.artist } : {}),
    file,
  });
}

songs.sort((left, right) => left.title.localeCompare(right.title, 'sk'));
await mkdir(songsDirectory, { recursive: true });
await writeFile(catalogFile, `${JSON.stringify({ songs }, null, 2)}\n`, 'utf8');
console.log(`Vygenerovaný songs/index.json: ${songs.length} skladba(y).`);
