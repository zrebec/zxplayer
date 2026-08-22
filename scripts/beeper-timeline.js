/**
 * Build the sounding events for a monophonic Beeper track.
 * Rest notes are omitted from the result, but their duration still advances the
 * following event offsets.
 */
export function createBeeperTimeline(notes) {
  if (!Array.isArray(notes)) throw new TypeError('createBeeperTimeline: notes must be an array');

  const events = [];
  let offsetMs = 0;

  for (const [index, note] of notes.entries()) {
    if (!note || !Number.isFinite(note.dur) || note.dur <= 0) {
      throw new RangeError(`createBeeperTimeline: note ${index + 1} must have a positive duration`);
    }

    const startMs = offsetMs;
    const endMs = startMs + note.dur;
    if (Number.isFinite(note.freq) && note.freq > 0) {
      events.push({ ...note, index, startMs, endMs });
    }
    offsetMs = endMs;
  }

  return events;
}

/**
 * Find the tone sounding at elapsedMs. Event starts are inclusive and ends are
 * exclusive, so an exact boundary belongs to the next event (or to silence).
 */
export function getActiveBeeperEvent(events, elapsedMs) {
  if (!Array.isArray(events)) throw new TypeError('getActiveBeeperEvent: events must be an array');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;

  const event = events.find(({ startMs, endMs }) => elapsedMs >= startMs && elapsedMs < endMs);
  if (!event) return null;

  return {
    event,
    remainingMs: event.endMs - elapsedMs,
  };
}
