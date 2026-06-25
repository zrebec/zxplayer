import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Zip } from 'zip-lib';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptFile);
const projectRoot = path.resolve(scriptDirectory, '..');
const projectName = path.basename(projectRoot);

const archiveDirectory = path.join(projectRoot, 'archive');

const excludedDirectoryNames = new Set(['archive', 'node_modules', '.git', 'coverage']);

const excludedFileNames = new Set(['.DS_Store']);

const pad = (value) => String(value).padStart(2, '0');

const getDateStamp = () => {
  const now = new Date();

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const getArchivePath = async () => {
  const dateStamp = getDateStamp();
  const baseName = `${projectName}-${dateStamp}`;

  let index = 1;

  while (true) {
    const suffix = index === 1 ? '' : `-${String(index).padStart(2, '0')}`;
    const candidate = path.join(archiveDirectory, `${baseName}${suffix}.zip`);

    try {
      await stat(candidate);
      index += 1;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return candidate;
      }

      throw error;
    }
  }
};

const collectFiles = async (directory, files = []) => {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(projectRoot, absolutePath);

    if (entry.isDirectory()) {
      if (!excludedDirectoryNames.has(entry.name)) {
        await collectFiles(absolutePath, files);
      }

      continue;
    }

    if (!entry.isFile() || excludedFileNames.has(entry.name)) {
      continue;
    }

    files.push({
      absolutePath,
      relativePath: relativePath.replaceAll(path.sep, '/'),
    });
  }

  return files;
};

const createArchive = async () => {
  await mkdir(archiveDirectory, { recursive: true });

  const archivePath = await getArchivePath();
  const files = await collectFiles(projectRoot);

  const zip = new Zip({
    compressionLevel: 9,
  });

  for (const file of files) {
    zip.addFile(file.absolutePath, file.relativePath);
  }

  await zip.archive(archivePath);

  console.log(`Archive created: ${path.relative(projectRoot, archivePath)}`);
  console.log(`Files included: ${files.length}`);
};

try {
  await createArchive();
} catch (error) {
  console.error('Project archive failed.');
  console.error(error);
  process.exitCode = 1;
}
