export function filterSongLibrary(songs, query) {
  const library = Array.isArray(songs) ? songs : [];
  const needles = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (needles.length === 0) return [...library];

  return library.filter((song) => {
    const audio = song?.catalog?.audio ?? {};
    const haystack = [song?.id, song?.title, song?.artist, audio.sourceFormat, audio.runtimeFormat, audio.chip]
      .map(normalizeSearchText)
      .join(' ');
    return needles.every((needle) => haystack.includes(needle));
  });
}

export function describeLibraryCount(visibleCount, totalCount) {
  const visible = normalizeCount(visibleCount);
  const total = normalizeCount(totalCount);
  if (visible === 0) return 'NO TRACKS';
  if (visible === total) return `${total} TRACKS`;
  return `${visible} / ${total} TRACKS`;
}

function normalizeSearchText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('sk')
    .trim();
}

function normalizeCount(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}
