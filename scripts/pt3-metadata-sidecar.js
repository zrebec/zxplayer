import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function pt3MetadataSidecarCandidates(sourceFile) {
  const extension = path.extname(sourceFile);
  const withoutExtension = sourceFile.slice(0, sourceFile.length - extension.length);
  return [`${sourceFile}.meta.json`, `${withoutExtension}.meta.json`];
}

export function generatedMetadataSidecarName(generatedPSGName) {
  return `${generatedPSGName}.meta.json`;
}

export async function readPT3MetadataSidecar(songsDirectory, sourceFile) {
  for (const candidate of pt3MetadataSidecarCandidates(sourceFile)) {
    try {
      const parsed = JSON.parse(await readFile(path.join(songsDirectory, candidate), 'utf8'));
      return {
        sourceFile: candidate,
        metadata: normalizePT3MetadataSidecar(parsed, candidate),
      };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error instanceof SyntaxError) {
        throw new Error(`${candidate}: neplatný PT3 metadata sidecar.`, { cause: error });
      }
      throw error;
    }
  }

  return undefined;
}

export async function writeGeneratedMetadataSidecar(generatedDirectory, generatedPSGName, metadata) {
  const outputName = generatedMetadataSidecarName(generatedPSGName);
  await writeFile(path.join(generatedDirectory, outputName), serializePT3MetadataSidecar(metadata), 'utf8');
  return outputName;
}

export async function removeGeneratedMetadataSidecar(generatedDirectory, generatedPSGName) {
  const outputName = generatedMetadataSidecarName(generatedPSGName);
  try {
    await unlink(path.join(generatedDirectory, outputName));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function normalizePT3MetadataSidecar(metadata, sourceFile = 'PT3 metadata sidecar') {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`${sourceFile}: metadata sidecar musí obsahovať JSON objekt.`);
  }

  return metadata;
}

export function serializePT3MetadataSidecar(metadata) {
  return `${JSON.stringify(normalizePT3MetadataSidecar(metadata), null, 2)}\n`;
}
