import { CHANNELS } from './channel-mixer.js';

export const CHANNEL_VOLUME_STORAGE_KEY = 'zxplayer.channelVolumes.v1';

function defaultVolumes() {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, 1]));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSongId(songId) {
  return typeof songId === 'string' && songId.length > 0;
}

function isVolume(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function sanitizeVolumes(value, fallback = defaultVolumes()) {
  const source = isRecord(value) ? value : {};

  return Object.fromEntries(
    CHANNELS.map((channel) => [channel, isVolume(source[channel]) ? source[channel] : fallback[channel]]),
  );
}

function readSongs(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};

  try {
    const parsed = JSON.parse(storage.getItem(CHANNEL_VOLUME_STORAGE_KEY));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSongs(storage, songs) {
  if (!storage || typeof storage.setItem !== 'function') return;

  try {
    storage.setItem(CHANNEL_VOLUME_STORAGE_KEY, JSON.stringify(songs));
  } catch {
    // Persistence is best-effort; playback must continue when storage is unavailable.
  }
}

export function loadChannelVolumes(storage, songId) {
  if (!isSongId(songId)) return defaultVolumes();

  const songs = readSongs(storage);
  return sanitizeVolumes(Object.hasOwn(songs, songId) ? songs[songId] : null);
}

export function saveChannelVolumes(storage, songId, volumes) {
  if (!isSongId(songId)) return defaultVolumes();

  const songs = readSongs(storage);
  const previous = sanitizeVolumes(Object.hasOwn(songs, songId) ? songs[songId] : null);
  const next = sanitizeVolumes(volumes, previous);
  writeSongs(storage, { ...songs, [songId]: next });
  return next;
}

export function resetChannelVolumes(storage, songId) {
  if (!isSongId(songId)) return defaultVolumes();

  const songs = readSongs(storage);
  if (Object.hasOwn(songs, songId)) {
    const nextSongs = { ...songs };
    delete nextSongs[songId];
    writeSongs(storage, nextSongs);
  }

  return defaultVolumes();
}
