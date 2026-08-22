import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  generatedMetadataSidecarName,
  pt3MetadataSidecarCandidates,
  readPT3MetadataSidecar,
  removeGeneratedMetadataSidecar,
  serializePT3MetadataSidecar,
  writeGeneratedMetadataSidecar,
} from '../scripts/pt3-metadata-sidecar.js';

test('sidecar paths preserve nested PT3 sources and generated unique names', () => {
  assert.deepEqual(pt3MetadataSidecarCandidates(path.join('nested', 'demo.pt3')), [
    path.join('nested', 'demo.pt3.meta.json'),
    path.join('nested', 'demo.meta.json'),
  ]);
  assert.equal(generatedMetadataSidecarName('Artist - Demo-02.psg'), 'Artist - Demo-02.psg.meta.json');
});

test('the source-name sidecar takes precedence over the extensionless fallback', async (context) => {
  const directory = await temporaryDirectory(context);
  await mkdir(path.join(directory, 'nested'), { recursive: true });
  await writeFile(path.join(directory, 'nested', 'demo.meta.json'), JSON.stringify({ id: 'fallback' }));
  await writeFile(path.join(directory, 'nested', 'demo.pt3.meta.json'), JSON.stringify({ id: 'preferred' }));

  assert.deepEqual(await readPT3MetadataSidecar(directory, path.join('nested', 'demo.pt3')), {
    sourceFile: path.join('nested', 'demo.pt3.meta.json'),
    metadata: { id: 'preferred' },
  });
});

test('the extensionless sidecar is used as a fallback and missing metadata is allowed', async (context) => {
  const directory = await temporaryDirectory(context);
  await mkdir(path.join(directory, 'nested'), { recursive: true });
  await writeFile(path.join(directory, 'nested', 'demo.meta.json'), JSON.stringify({ title: 'Nested demo' }));

  assert.deepEqual(await readPT3MetadataSidecar(directory, path.join('nested', 'demo.pt3')), {
    sourceFile: path.join('nested', 'demo.meta.json'),
    metadata: { title: 'Nested demo' },
  });
  assert.equal(await readPT3MetadataSidecar(directory, 'missing.pt3'), undefined);
});

test('generated metadata is validated and written as normalized JSON', async (context) => {
  const directory = await temporaryDirectory(context);
  const metadata = {
    id: 'demo',
    catalog: { audio: { sourceFormat: 'pt3-module', runtimeFormat: 'psg-register-dump' } },
  };

  const outputName = await writeGeneratedMetadataSidecar(directory, 'Demo.psg', metadata);
  assert.equal(outputName, 'Demo.psg.meta.json');
  assert.equal(await readFile(path.join(directory, outputName), 'utf8'), serializePT3MetadataSidecar(metadata));
  assert.throws(() => serializePT3MetadataSidecar([]), /JSON objekt/);
});

test('a stale generated sidecar can be removed without failing when it is already absent', async (context) => {
  const directory = await temporaryDirectory(context);
  const staleSidecar = path.join(directory, 'Demo.psg.meta.json');
  await writeFile(staleSidecar, '{"id":"stale"}\n');

  assert.equal(await removeGeneratedMetadataSidecar(directory, 'Demo.psg'), true);
  await assert.rejects(readFile(staleSidecar), { code: 'ENOENT' });
  assert.equal(await removeGeneratedMetadataSidecar(directory, 'Demo.psg'), false);
});

async function temporaryDirectory(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zxplayer-pt3-sidecar-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
