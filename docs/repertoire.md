# Repertoire

What the catalogue holds today, and the open proposal for making part of it seasonal.

Everything below was read out of `songs/` and `songs/index.json` on **2026-09-22**, not from
memory. Counts here are the ones `npm run build` prints.

---

## 1. The catalogue as it stands

**23 songs**, every one `type: "json"`, every one `rightsStatus: "documented"`. Twenty-two play
through `zx-kit`; one (`stereo_ambulance`) is a procedural Web Audio effect.

| Group                                     | Count | Songs                                                                                                                                                                                                            |
| ----------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original, written for this player in 2026 |     8 | Arctic Circuit · Bitshift Boulevard · Midnight Power Play · Neon Warren · One-Bit Night Shift · Orbital Foundry · Signal over Tatras · Tilebound Rabbit                                                          |
| Public-domain arrangements                |    12 | Brahms' Lullaby · Frère Jacques · Greensleeves · In the Hall of the Mountain King · Infernal Galop · Korobeiniki · Minuet in G · Nad Tatrou sa blýska · Ode to Joy · The Blue Danube · Turkish March · Wilhelmus |
| Game and house tracks                     |     2 | AY Soundcheck (the 31-second reference) · Chaosbunny Escape                                                                                                                                                      |
| Procedural effect                         |     1 | Sanitka (Doppler)                                                                                                                                                                                                |

**15 of the 23 carry a beeper track** alongside the AY channels. The oldest arrangement is
Wilhelmus (c. 1570); the newest originals are dated 2026-09-11 and 2026-09-12.

### Two facts worth knowing before planning anything

1. **No PSG song ships.** The player has a complete PSG path — `loadPSG()`, one `playAYDump()`
   worklet core, a PT3 converter, sidecar metadata — and the catalogue uses none of it. Every
   entry is a hand-authored JSON arrangement. The PSG code is unit-tested but has no song
   exercising it end to end.
2. **Two real scene tracks sit in quarantine.** `git stash list` holds
   `stash@{0}: quarantined scene tracks (awaiting author consent)` — `je_main_trigger5.pt3` and
   `nq - rgbk+ (2026).psg`, parked on 2026-07-12 pending the author's answer, which has not come.
   They are the obvious first PSG songs _if_ consent arrives. Until then they stay stashed and
   unpushed.

---

## 2. Proposal — a seasonal repertoire

The owner's idea, recorded 2026-09-22: **Christmas carols in December, school songs through
September, and on Halloween a hard stop that allows no other work that day.**

Nothing below is implemented. This section is the design argument, so the decision can be made
once rather than re-argued.

### 2.1 Christmas — carols in December

**What is wanted:** Christmas songs in the catalogue around Christmas. Add or replace is
explicitly undecided.

**Options**

|     | Approach                                                                                                                       | What it costs                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Add permanently.** Carols become ordinary catalogue entries.                                                                 | The library grows 23 → ~30. It already needed a filter at 23 — that filter was written this month for exactly this reason.                                                                                                                                                         |
| B   | **Replace in season.** December swaps part of the catalogue out.                                                               | The catalogue stops being a fixed list. A build would depend on the date, so two people building the same commit get different sites, and `git diff --exit-code songs/index.json` — the CI step that guarantees the catalogue matches its sources — would fail on a date boundary. |
| C   | **Tag, never hide.** Each song gets `catalog.season`; during its window the player surfaces it first. Nothing is ever removed. | A little UI work: the tag, an ordering rule, a badge.                                                                                                                                                                                                                              |

**The argument against A alone:** a carol is wrong eleven months a year. Not offensive — just
noise in a list you are trying to read. The filter helps only if you already know you want it.

**The argument against B:** it is the only option that can _lose_ something. Replacing means the
player deliberately hides songs somebody may want, and it makes the catalogue a function of the
clock. This repository's whole CI gate rests on the catalogue being a pure function of `songs/` —
B breaks that for a cosmetic gain.

**The argument against C:** it is the most code. It needs a `season` field through
`normalizeCatalog`, an ordering rule in the library render, and a badge in the card. Call it a
half-day including tests.

**Recommendation: C, with A's honesty.** Add the carols as real catalogue entries — they are good
arrangements, they should exist all year — and give every song an optional `catalog.season`. In
window, seasonal songs sort to the top of the library and wear a badge. Out of window they are
ordinary songs, findable by the filter like anything else. Nothing is hidden, the build stays
deterministic, and the date is read at render time, never at generate time.

One free win: `filterSongLibrary` builds its haystack from title, artist, id, chip and format.
Adding `season` to that haystack makes typing `christmas` work with no further UI at all.

**Rights are the real constraint, not taste.** Every entry today is `rightsStatus: documented`,
and carols are where that gets dangerous. _Silent Night_ (1818), _O Holy Night_ (1847),
_Good King Wenceslas_ (1853), _Deck the Halls_, _Tichá noc_ — public domain, safe. _Rudolph_
(1949), _White Christmas_ (1942), _Last Christmas_ (1984), _All I Want for Christmas Is You_
(1994) — **firmly in copyright**, and the fact that a chiptune arrangement sounds nothing like
the original does not change that. Any carol entering this catalogue passes the same rights gate
as everything else in it.

### 2.2 Halloween — the hard stop

**What is wanted, in the owner's words:** on Halloween a message fires immediately saying it is
Halloween, that today's only task is this, and that no other work gets through — _"ani po
ukecávaní"_. Explicitly a lock the owner is building **against himself**.

**The honest problem with the obvious solution.** A rule written in `CLAUDE.md` or `AGENTS.md` is
not a lock. It is an instruction to an agent whose job is to do what the owner asks. When the
owner says "yes I know, but today I want to fix Ice Haul", a markdown sentence loses — and it
should, because the alternative is an assistant that argues with its owner about his own
priorities. Worse, the owner can ask for that file to be edited, and then the lock argues for its
own removal. **A lock that depends on my goodwill is a reminder, not a lock.**

**Options**

|     | Approach                                                                                                              | Enforced by | Honest verdict                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| A   | A rule in `CLAUDE.md` / `AGENTS.md`                                                                                   | me          | Reliable as an _announcement_. Useless as a _lock_.                  |
| B   | A `PreToolUse` hook in `.claude/settings.json` that refuses `Edit`/`Write` outside an allowed path list on 31 October | the harness | A real lock — the tool call fails before I see it.                   |
| C   | A `pre-commit` hook in the repo refusing off-theme commits that day                                                   | git         | Weakest: it polices commits, not the work, and `--no-verify` exists. |

**The argument against B, which has to be said:** a real lock is real on the bad days too. If
production breaks on 31 October, the lock is standing in the doorway. And a lock with no
documented way out gets broken open in a panic — and a lock that has been smashed once is never
switched on again. An escape hatch is not a hole in this design; it is what keeps the design
alive past its first collision with reality.

**Recommendation: A and B together, with a deliberate hatch.**

1. **Announcement (A).** A standing rule that on any seasonal date the _first line_ of my first
   reply names the day and the day's task. This part I can promise, and it is what actually
   changes behaviour most days — the owner is not fighting the lock, he simply forgot.
2. **Lock (B).** A `PreToolUse` hook that, on 31 October, refuses writes outside
   `songs/`, `assets/covers/`, `docs/repertoire.md` with a message saying why.
3. **Hatch.** The hook honours one environment variable, e.g. `ZXP_SEASON_OVERRIDE=1`. Unlocking
   costs a deliberate keystroke, not a conversation — which is exactly the property wanted here:
   the owner should not be able to _drift_ past the lock, but he must be able to _decide_ past it.

Writing that hook touches `~/.claude/settings.json`, which is outside this repository and outside
today's task, so it is proposed here and not installed. Say the word and it is a ten-minute job;
the `update-config` skill exists for precisely this.

**One more caution.** Halloween is one day. A hook that reads the date must be right about
_which_ day, in the owner's timezone, and must fail open if anything about that check goes wrong.
A lock that mistakenly fires on 30 October is how this feature gets deleted in week one.

### 2.3 September — school songs

**What is wanted:** school songs for the whole of September.

**The mechanism is the same as Christmas** — `catalog.season: "school"` and a window of 1–30
September. No new machinery.

**The argument against treating it like Christmas:** September is a _month_, an entire twelfth of
the year. If seasonal songs sort to the top, then for one month in twelve the library opens on a
themed shelf rather than on the catalogue. Christmas earns that — the window is short and the
association is overwhelming. A month of school songs is a long time to push Arctic Circuit down
the page.

There is a second, quieter problem: "school songs" is a culturally narrow category — largely
Slovak and Czech — in a catalogue that is otherwise European classical plus original chiptune. It
will read as a different project unless it is chosen deliberately.

**Recommendation: yes, but quieter than Christmas.** Give September songs the badge and the
filter, and let them be _findable_ rather than _first_. Reserve the sort-to-top behaviour for the
short, high-association windows. Concretely: a `prominence` on the season definition — `"top"`
for Christmas and Halloween, `"badge"` for September.

### 2.4 The shape this suggests

One table, in one place, is all three ideas:

```js
// Proposed — not implemented.
export const SEASONS = {
  christmas: { from: '12-01', to: '12-26', prominence: 'top', label: 'CHRISTMAS' },
  halloween: { from: '10-31', to: '10-31', prominence: 'top', label: 'HALLOWEEN' },
  school: { from: '09-01', to: '09-30', prominence: 'badge', label: 'BACK TO SCHOOL' },
};
```

Songs carry `catalog.season`, the window is evaluated when the library renders, and the build
never sees a date. The Halloween _lock_ is a separate mechanism living in the harness, not here —
the same word, two different machines, and confusing them is how the lock ends up unenforceable.

### 2.5 Open decisions, for the owner

| #   | Decision                                                    | Recommendation                                                                |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Add carols or swap them in?                                 | **Add.** Never swap — it breaks the deterministic catalogue.                  |
| 2   | Does a seasonal song sort to the top, or only wear a badge? | Top for Christmas/Halloween, badge for September.                             |
| 3   | Install the Halloween hook, or keep the announcement only?  | Install both; the announcement alone will not hold.                           |
| 4   | Is the hatch an env var, or nothing at all?                 | An env var. A hatchless lock gets destroyed.                                  |
| 5   | Which school songs, specifically?                           | Needs the owner — the category is his, not mine, and the rights gate applies. |
| 6   | Do the quarantined scene tracks ever land?                  | Chase the author's consent or drop them; two months of silence is an answer.  |
