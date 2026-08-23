export function createPlaybackClock(audioContext, startDelayMs) {
  if (!audioContext || !Number.isFinite(audioContext.currentTime)) {
    throw new TypeError('createPlaybackClock: audioContext.currentTime must be finite');
  }
  if (!Number.isFinite(startDelayMs)) {
    throw new TypeError('createPlaybackClock: startDelayMs must be finite');
  }

  const safeStartDelayMs = Math.max(0, startDelayMs);
  const audioStartTime = audioContext.currentTime + safeStartDelayMs / 1000;

  function getStartDelayMs() {
    return Math.max(0, (audioStartTime - audioContext.currentTime) * 1000);
  }

  function getElapsedMs() {
    return Math.max(0, (audioContext.currentTime - audioStartTime) * 1000);
  }

  function getRemainingMs(durationMs) {
    const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    return Math.max(0, safeDurationMs - getElapsedMs());
  }

  return Object.freeze({ audioStartTime, getStartDelayMs, getElapsedMs, getRemainingMs });
}
