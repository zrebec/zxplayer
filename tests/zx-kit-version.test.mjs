import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDirectory = path.join(projectDirectory, 'scripts');
const expectedVersion = '0.45.0';
const expectedCDN = `https://cdn.jsdelivr.net/npm/zx-kit@${expectedVersion}/dist/index.js`;

test('npm, lockfile, installed package, and browser wrapper use one exact zx-kit version', async () => {
  const [packageJson, packageLock, installedPackage, wrapper] = await Promise.all([
    readJson('package.json'),
    readJson('package-lock.json'),
    readJson('node_modules/zx-kit/package.json'),
    readFile(path.join(scriptsDirectory, 'zx-kit.js'), 'utf8'),
  ]);

  assert.equal(packageJson.devDependencies['zx-kit'], expectedVersion);
  assert.equal(packageLock.packages[''].devDependencies['zx-kit'], expectedVersion);
  assert.equal(packageLock.packages['node_modules/zx-kit'].version, expectedVersion);
  assert.equal(installedPackage.version, expectedVersion);
  assert.match(wrapper, new RegExp(`^export \\* from '${escapeRegExp(expectedCDN)}';\\n$`));
});

test('the local browser wrapper is the only JavaScript source containing the zx-kit CDN URL', async () => {
  const sourceFiles = (await listJavaScriptFiles(scriptsDirectory)).sort();
  const occurrences = [];

  for (const file of sourceFiles) {
    const source = await readFile(path.join(scriptsDirectory, file), 'utf8');
    for (const match of source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/zx-kit@[^'"\s]+/g)) {
      occurrences.push({ file, url: match[0] });
    }
  }

  assert.deepEqual(occurrences, [{ file: 'zx-kit.js', url: expectedCDN }]);
});

test('installed zx-kit exports every API used by the browser entry points', async () => {
  const zxKit = await import('zx-kit');
  const expectedExports = [
    'AY_ENVELOPE_SHAPES',
    'AY_MACHINE',
    'C',
    'createBitmapFromRows',
    'drawBitmap',
    'getAudioContext',
    'getMasterGain',
    'initAudio',
    'loadPSG',
    'noteToFreq',
    'playAY',
    'playAYDump',
    'playPattern',
    'seq',
    'setupCanvas',
  ];

  assert.deepEqual(
    expectedExports.filter((name) => !(name in zxKit)),
    [],
  );
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectDirectory, relativePath), 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listJavaScriptFiles(directory, relativeDirectory = '') {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await listJavaScriptFiles(directory, relativePath)));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(relativePath);
  }

  return files;
}
