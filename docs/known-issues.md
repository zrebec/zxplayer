# Known issues

Open, reproducible gaps. Verified against the code on **2026-09-22**; each entry says how it was
checked, so the next reader can re-check rather than trust it.

---

## 1. `engines` is documented but not declared

**Status:** fixed 2026-09-22 — kept here because the mismatch lasted months.

`README.md` said "Node.js 22 or newer" and `AGENTS.md` said `Engine | Node.js >=22`, while
`package.json` declared no `engines` field at all. Nothing stopped an install on Node 18, where
the test runner's flags differ and failures would look like code bugs.

`engines.node: ">=22"` is declared now. CI runs Node 24.

```bash
node -p "require('./package.json').engines?.node ?? 'MISSING'"
```

## 2. The package has no `version`

**Status:** open. Deliberate? Undecided.

`package.json` carries `name`, `private: true` and no `version`. That is legal for a private
package and harmless while nothing reads it — but it also means the player cannot show what
build it is, and `npm run archive` dates a ZIP by the clock rather than by a release.

Every sibling repository (`zx-kit`, `minefield`, `iceroads`, `chaosbunny`) versions itself through
semantic-release. This one does not, and the question of whether it should has never been asked
out loud.

**If it should:** the cheapest version is a manual `version` bumped by hand, shown in the page
footer. Full semantic-release here would mean conventional-commit discipline in a repository that
has not been keeping it (`feat(updgrade): upgraded zxplayer to implements nevest zx-kit`).

## 3. No PSG song ships, so the PSG path is never exercised end to end

**Status:** open.

The player has a complete register-dump path: `loadPSG()`, one `playAYDump()` worklet core, a PT3
converter and sidecar metadata. The catalogue has **23 songs, all `type: "json"`**. Not one of
them takes that path.

```bash
node -p "JSON.parse(require('fs').readFileSync('songs/index.json','utf8')).songs.map(s=>s.type).join(',')"
```

Unit tests cover the adapter and the converter, but no song proves the whole chain works in a
browser. The two real PSG/PT3 candidates are in quarantine — see `docs/repertoire.md` §1.

## 4. Two scene tracks have been waiting on consent since 2026-07-12

**Status:** open, blocked on a third party.

`git stash@{0}` holds `je_main_trigger5.pt3` and `nq - rgbk+ (2026).psg`, stashed pending the
author's permission. Two months of silence. They must not be pushed without consent; the decision
to chase or to drop has not been made.

```bash
git stash list
```

## 5. `zx-kit` is pinned at 0.45.0; the kit is at 0.46.1

**Status:** open, low risk.

The pin is exact and consistent in three places (npm dependency, lockfile, CDN wrapper) and a test
enforces that agreement — that part is healthy. But the sibling `engine/zx-kit` released 0.46.1 on
2026-08-27, so the player is one minor behind and nobody has read the changelog to see whether it
matters.

```bash
node -p "require('./package.json').devDependencies['zx-kit']"
grep -o 'zx-kit@[0-9.]*' scripts/zx-kit.js
```

## 6. The site depends on a CDN at runtime

**Status:** open, by design — recorded because the failure mode is invisible.

`scripts/zx-kit.js` imports `zx-kit` from jsDelivr. If jsDelivr is unreachable, the deployed page
loads its HTML, CSS and covers and then does nothing at all, with the failure only in the console.
The offline story Minefield has (a bundled copy, a service worker) does not exist here.

Whether that matters depends on whether this is a tool or a product. As a tool for one person with
a network connection, it is fine.

---

## Resolved

### Cover art 404'd on GitHub Pages — fixed 2026-09-22 (`8443b9b`)

Every catalogue cover was written as `/assets/covers/<id>/cover.png`. The leading slash means
"from the domain root", which is correct on a local server rooted at `/` and wrong on Pages, where
the site is served from `/zxplayer/`. The files deployed correctly; the page asked
`zrebec.github.io/assets/…` and got 404 for all 23, so the library rendered empty.

Fixed in three layers: catalogue paths are relative, `scripts/cover-url.js` resolves them against
the page and strips a stray leading slash, and `tests/cover-url.test.mjs` rejects any song that
carries one.

**The lesson that generalises:** two existing assertions in `song-catalog-metadata.test.mjs`
expected the leading slash. They were pinning the bug, and they passed the whole time. A test that
asserts the current shape of data is not the same as a test that asserts the data is _right_.

### The repository had no CI — fixed 2026-09-22 (`c4e483f`)

Pages was configured to build from Actions and no workflow existed. See `README.md` §Continuous
Integration and Deployment.
