export const FALLBACK_COVER = 'assets/covers/fallback/cover.png';

/**
 * Resolves a catalogue cover path against the page it will be shown on.
 *
 * The player is served from a subdirectory on GitHub Pages (`/zxplayer/`), and that is
 * the whole reason this function exists: a path beginning with `/` asks the domain root,
 * which works perfectly on a local server rooted at `/` and 404s on Pages. Every cover in
 * the catalogue was written that way once, and the library came up blank.
 *
 * So catalogue paths are relative, and a leading slash is stripped rather than trusted —
 * one stale entry should not be able to blank the library again. Absolute URLs
 * (`https:`, `data:`, protocol-relative) are passed through untouched.
 */
export function resolveCoverUrl(cover, base, fallback = FALLBACK_COVER) {
  const raw = nonEmpty(cover) ?? nonEmpty(fallback) ?? FALLBACK_COVER;
  // `//host/path` is a real protocol-relative URL; `///path` is just a slashed path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || /^\/\/[^/]/.test(raw)) return raw;
  const relative = raw.replace(/^\/+/, '');
  return base ? new URL(relative, base).href : relative;
}

function nonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
