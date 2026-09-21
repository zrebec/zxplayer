# CLAUDE.md — zxplayer

**`AGENTS.md` is the single source of truth for this repository.** Read it. Everything about the
project's scope, the AY architecture, the song format, the repository layout, the npm commands, the
CI pipeline and the editing rules lives there, and is not repeated here.

This file holds only what is specific to working with **Claude** in this repository — the traps
that have actually cost time here, not general advice.

---

## 1. Verify against the code, never against a document

Three claims in this repository's own documentation were false on 2026-09-22, and each had been
false for months:

- `README.md` and `AGENTS.md` promised `Node >=22`; `package.json` declared no `engines` at all.
- The README listed PSG playback as a feature; the catalogue contains **no PSG song** — all 23
  entries are JSON arrangements.
- Two test assertions pinned cover paths to a shape that was broken in production.

So: before writing a number, a count or a capability into any document, **read it out of the code
in this session**. `songs/index.json` for counts, `package.json` for versions, `npm test` for the
test total. A number copied from a document is a number that was true once.

## 2. Paths to assets are relative — never start one with `/`

The page is served from `https://zrebec.github.io/zxplayer/`. A path beginning with `/` asks the
domain root, which works perfectly on a local server and 404s on Pages. That cost the entire cover
library once (`8443b9b`).

`scripts/cover-url.js` resolves and defends this, and `tests/cover-url.test.mjs` fails on any song
carrying a leading slash. Do not weaken either.

## 3. After touching `songs/`, run `npm run build` and commit `songs/index.json`

The catalogue is generated. CI runs `git diff --exit-code songs/index.json` and fails when the
committed catalogue disagrees with the sources beside it. This is the single easiest way to turn
CI red here.

## 4. Run `npm run format` before committing, not `format:check`

CI checks formatting; it does not fix it. Prettier covers **everything**, YAML workflows and
Markdown included, so a hand-written workflow file will fail the check.

## 5. `zx-kit` is read-only, and that is absolute

`~/Projects/retro/engine/zx-kit` must not be edited, extended or built from here. If something is
missing in the kit, say so and stop — do not work around it by copying kit code into this
repository. `AGENTS.md` §2 states this as a hard rule and it has never been relaxed.

## 6. What Claude cannot verify here

**Sound.** Nothing in this repository proves a song sounds good, and I cannot hear it. Tests prove
a song compiles, validates against `zx-kit` and keeps its AY and beeper timelines aligned. Whether
an arrangement is _musical_ is the owner's ear, always. Never report a tuning or arrangement task
as finished; report it as "compiles, validates, needs your ear".

The same applies to the covers: a test proves a `.scr` is hardware-valid, never that it looks good.

## 7. The owner commits and releases; he pushes too

Do not push without being asked. The owner has pushed mid-session before — check
`git status -sb` rather than assuming what is or is not on the remote. Related and recorded at the
ecosystem level: repository docs and tags **lag** the real release state, so never state release
status from a ROADMAP alone.

## 8. Seasonal repertoire — a proposal, not a rule yet

`docs/repertoire.md` §2 holds the owner's seasonal idea (Christmas carols, September school songs,
and a Halloween lock that is supposed to refuse all other work that day). **None of it is
implemented, and the Halloween lock is not something a markdown file can enforce** — if it is ever
wanted for real it belongs in a `PreToolUse` hook, which lives outside this repository. Until the
owner decides, treat that section as a design document: do not act on it, and do not quietly start
enforcing it.

If a seasonal window is live and the work at hand is seasonal, say so in the first line of the
reply. That is an announcement, not a refusal.

## 9. Rights are checked, not assumed

Every catalogue entry is `rightsStatus: "documented"`. Any new arrangement must clear the same
gate before it lands. Public-domain status is a date question and the answer is frequently "no" for
anything that sounds traditional — Christmas carols especially. When unsure, say unsure.
