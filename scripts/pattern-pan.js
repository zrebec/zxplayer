export function resolveChannelDefaultPan(authoredPan, stereoPan = 0) {
  return authoredPan ?? stereoPan;
}

export function materializePatternPan(pattern, defaultPan = 0) {
  if (pattern.sweep) {
    let cursorMs = 0;
    const notes = pattern.notes.map((note) => {
      const startProgress = pattern.duration > 0 ? cursorMs / pattern.duration : 0;
      cursorMs += note.dur;
      const endProgress = pattern.duration > 0 ? cursorMs / pattern.duration : 1;
      return {
        ...note,
        pan: pattern.sweep.from + (pattern.sweep.to - pattern.sweep.from) * startProgress,
        panTo: pattern.sweep.from + (pattern.sweep.to - pattern.sweep.from) * endProgress,
      };
    });

    return { notes, pan: undefined, sweep: pattern.sweep };
  }

  const pan = pattern.pan ?? defaultPan;
  const notes = pattern.notes.map((note, index) => (index === 0 ? { ...note, pan } : note));
  return { notes, pan, sweep: null };
}
