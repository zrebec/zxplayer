export function createPlaybackQueue() {
  let queueTail = Promise.resolve();

  function enqueue(start, isCurrent = () => true) {
    if (typeof start !== 'function' || typeof isCurrent !== 'function') {
      throw new TypeError('playback queue expects start and isCurrent functions');
    }

    const queuedPlayback = queueTail.then(() => (isCurrent() ? start() : null));
    queueTail = queuedPlayback.then(
      () => undefined,
      () => undefined,
    );
    return queuedPlayback;
  }

  return Object.freeze({ enqueue });
}
