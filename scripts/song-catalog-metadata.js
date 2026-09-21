import path from 'node:path';

export const DEFAULT_COVER = '/assets/covers/fallback/cover.png';
export const RIGHTS_KEYS = ['composition', 'arrangement', 'source', 'cover'];
export const RIGHTS_STATUSES = ['public-domain-eu', 'all-rights-reserved', 'licensed', 'unverified'];

export function isMetadataSidecar(file) {
  return path.basename(file).toLowerCase().endsWith('.meta.json');
}

export function isSupportedSongFile(file) {
  if (path.basename(file) === 'index.json' || isMetadataSidecar(file)) return false;
  return ['.json', '.psg'].includes(path.extname(file).toLowerCase());
}

export function metadataSidecarCandidates(file) {
  const extension = path.extname(file);
  const withoutExtension = file.slice(0, file.length - extension.length);
  return [`${file}.meta.json`, `${withoutExtension}.meta.json`];
}

export function normalizeCatalog(catalog, context = {}) {
  const source = isRecord(catalog) ? catalog : {};
  const rightsSource = isRecord(source.rights) ? source.rights : {};
  const rights = Object.fromEntries(RIGHTS_KEYS.map((key) => [key, normalizeRightsEntry(rightsSource[key])]));

  return {
    ...source,
    releaseYear: Number.isInteger(source.releaseYear) ? source.releaseYear : null,
    originalDate: nonEmptyString(source.originalDate) ?? null,
    cover: nonEmptyString(source.cover) ?? DEFAULT_COVER,
    audio: normalizeAudio(source.audio, context),
    rights,
    rightsStatus: deriveRightsStatus(rights),
  };
}

export function deriveRightsStatus(rights) {
  if (!isRecord(rights)) return 'unverified';
  return RIGHTS_KEYS.every((key) => isDocumentedRightsEntry(rights[key])) ? 'documented' : 'unverified';
}

function normalizeAudio(audio, context) {
  const source = isRecord(audio) ? audio : {};
  const type = context.type === 'psg' ? 'psg' : 'json';
  const defaultSourceFormat = type === 'psg' ? 'psg-register-dump' : context.effect ? 'json-effect' : 'json-notes';
  const defaultRuntimeFormat = type === 'psg' ? 'audio-worklet' : context.effect ? 'web-audio' : 'zx-kit-playback';
  const defaultChip = context.effect
    ? 'procedural Web Audio effect'
    : context.machine === 'atariST'
      ? 'YM2149'
      : 'AY-3-8910';

  return {
    ...source,
    sourceFormat: nonEmptyString(source.sourceFormat) ?? defaultSourceFormat,
    runtimeFormat: nonEmptyString(source.runtimeFormat) ?? defaultRuntimeFormat,
    chip: nonEmptyString(source.chip) ?? defaultChip,
  };
}

function normalizeRightsEntry(entry) {
  if (!isRecord(entry)) return unverifiedRightsEntry();

  const status = RIGHTS_STATUSES.includes(entry.status) ? entry.status : 'unverified';
  const label = nonEmptyString(entry.label);

  if (status === 'unverified' || !label) {
    return {
      ...entry,
      status: 'unverified',
      label: label ?? 'Rights information has not been verified.',
    };
  }

  return {
    ...entry,
    status,
    label,
  };
}

function isDocumentedRightsEntry(entry) {
  if (!isRecord(entry) || entry.status === 'unverified' || !nonEmptyString(entry.label)) return false;
  if (entry.status === 'all-rights-reserved') return Boolean(nonEmptyString(entry.holder));
  if (entry.status === 'licensed') {
    return Boolean(nonEmptyString(entry.licenseUrl) || nonEmptyString(entry.evidenceUrl));
  }
  if (entry.status === 'public-domain-eu') return Boolean(nonEmptyString(entry.evidenceUrl));
  return false;
}

function unverifiedRightsEntry() {
  return {
    status: 'unverified',
    label: 'Rights information has not been verified.',
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
