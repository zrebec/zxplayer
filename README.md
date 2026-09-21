# ZX-KIT Player

A lightweight, data-driven browser player for three-channel AY music with an optional, independent ZX beeper track, written with [`zx-kit`](https://www.npmjs.com/package/zx-kit).

Songs can be hand-authored JSON arrangements or PSG register dumps. JSON songs build three AY tracks—channels **A**, **B**, and **C**—from named patterns and arrangements, then pass them to upstream `zx-kit.playAY()`. They may also declare a separate one-bit beeper track played by `zx-kit.playPattern()` in parallel, without changing the AY emulation. PSG songs are loaded with `zx-kit.loadPSG()` and played by upstream `zx-kit.playAYDump()` through one sample-accurate chip core.

![ZX-KIT Player screenshot](assets/screenshot.png)

## Features

- One JSON file per song in `songs/`.
- PSG register-dump playback through upstream `zx-kit` `loadPSG()` and one `playAYDump()` AudioWorklet core.
- PT3 source modules are converted offline to PSG before playback.
- A twenty-three-item built-in catalogue headed by the 31-second public **AY Soundcheck**.
- Eight original 2026 tracks and eight new public-domain arrangements spanning ABC, ACB, Beeper-only, and AY + Beeper mixes.
- Responsive cover-based song library with a diacritic-insensitive filter and unique hardware-valid ZX Spectrum artwork.
- Catalogue metadata for release/original dates, source and runtime formats, target chip, and structured rights.
- Separate **Play** and **Stop** controls.
- Live monitor for AY channels A/B/C and the optional beeper track.
- Per-channel **MUTE** and exclusive **SOLO** controls for JSON, PSG, and ambulance playback.
- Independent 0–100% channel faders, remembered per song in local storage.
- Runtime MONO, ACB, and ABC stereo selection.
- Full `zx-kit` AY notes: per-note duration, amplitude, noise period, hardware envelope shape, and envelope cycle.
- Optional per-channel stereo pan.
- Optional pattern/arrangement-driven beeper track through the isolated `playPattern()` gain/stop handle.
- One local playback adapter routes mixer, stereo, and stop controls to the upstream AY, Beeper, and PSG handles.
- Pattern-level timeline visualisation: active pattern, pass, step, token, tone/noise/rest, volume, and envelope.
- No frontend build tool or framework required.
- Formatting enforced with Prettier.
- Reproducible source archives via `npm run archive`.

## Requirements

- Node.js 22 or newer (required by the development dependency on `zx-kit`).
- A modern browser with ES modules, `fetch()`, Web Audio support, and JavaScript enabled.
- An HTTP server for local development. Opening the page directly with `file://` will not work because browsers block JSON loading via `fetch()` in that context.

The exact `zx-kit` version is `0.45.0` in both npm and the sole browser wrapper, `scripts/zx-kit.js`. The wrapper imports that release from jsDelivr, so the browser needs internet access when the player is opened unless the CDN module is replaced with a local bundled copy.

## Quick Start

Install the locked development dependencies:

```bash
npm ci
```

Generate the song catalogue and start a local static server:

```bash
npm run build
python -m http.server 8080
```

Open `http://localhost:8080` in your browser.

On Windows, the equivalent command is often:

```powershell
py -m http.server 8080
```

Press **Play** after the page loads. Browsers require an explicit user gesture before they allow Web Audio output.

## NPM Commands

| Command                  | Purpose                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `npm run songs:convert`  | Converts PT3 source modules to generated PSG register dumps.                                     |
| `npm run songs:generate` | Scans song JSON files and writes `songs/index.json`.                                             |
| `npm run songs:validate` | Compiles and validates every song against the installed `zx-kit`.                                |
| `npm test`               | Runs the Node tests for the mixer, playback adapter, Soundcheck, catalogue, and version pinning. |
| `npm run build`          | Regenerates the catalogue and validates every song.                                              |
| `npm run site`           | Runs the build, then assembles the deployable site into `_site/`.                                |
| `npm run format`         | Formats the project with Prettier.                                                               |
| `npm run format:check`   | Checks whether the project already matches the configured Prettier style.                        |
| `npm run archive`        | Regenerates the song catalogue, then creates a dated source ZIP in `archive/`.                   |

The current `npm test` suite covers mixer and persisted-volume policy, song-library filtering, real song-channel availability, the unified playback adapter, exact AY Soundcheck timing, Sanitka phase automation, PT3 sidecars, catalogue metadata, and agreement between the npm, lockfile, installed, and browser-wrapper `zx-kit` versions. Upstream audio interpretation remains covered by `zx-kit`; this repository does not duplicate its AY, Beeper, or PSG renderer tests.

## Continuous Integration and Deployment

Every push to `main` runs [`.github/workflows/ci-deploy.yml`](.github/workflows/ci-deploy.yml), and the page is published from what that run produces. A pull request runs the same checks but deploys nothing.

1. **Verify** — `npm run format:check`, `npm test`, `npm run build`, then `git diff --exit-code songs/index.json`. That last step fails when the committed catalogue does not match what the generator produces, so the page can never serve songs that disagree with their sources; the fix is to run `npm run build` and commit the result.
2. **Build** — `npm run site` assembles `_site/` and fails if anything the page cannot load without is missing.
3. **Deploy** — `_site/` is published to GitHub Pages.

Because `npm run site` is the same command the workflow runs, a deploy can be reproduced locally: run it, serve `_site/` with any static server, and what you see is what Pages will serve. No bundler is involved — the modules are served exactly as written, and `zx-kit` still arrives from the CDN through `scripts/zx-kit.js`.

## Project Structure

```text
.
├── assets/
│   ├── covers/<song-id>/{cover.png,cover.scr,cover-4x.png}
│   └── screenshot.png
├── scripts/
│   ├── archive-project.mjs
│   ├── ambulance-phases.js
│   ├── channel-mixer.js
│   ├── channel-volume-store.js
│   ├── generate-song-library.mjs
│   ├── pattern-pan.js
│   ├── playback-adapter.js
│   ├── playback-clock.js
│   ├── playback-queue.js
│   ├── PT3PSGConverter.mjs
│   ├── pt3-metadata-sidecar.js
│   ├── song-catalog-metadata.js
│   ├── song-channel-availability.js
│   ├── song-library-filter.js
│   ├── validate-songs.mjs
│   ├── player.js
│   └── zx-kit.js
├── tests/
├── songs/
│   ├── _new_song.json.example
│   ├── *.json                    # 23 built-in song/effect sources
│   └── index.json
├── .gitattributes
├── .gitignore
├── .prettierrc
├── index.html
├── package.json
├── package-lock.json
├── README.md
└── style.css
```

## Playback Architecture

All browser modules import `zx-kit` through `scripts/zx-kit.js`. That wrapper contains the project's only JavaScript CDN URL and re-exports the exact `0.45.0` release. The same exact version—without a semver range—is installed for Node-side validation, and `tests/zx-kit-version.test.mjs` prevents the npm, lockfile, installed package, and wrapper versions from drifting apart.

| Source                 | Upstream playback path                   | Live control used by the player                              |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| JSON channels A/B/C    | One `playAY()` call when AY is audible   | `AYHandle.setChannelGain()`, `setStereoMode()`, and `stop()` |
| Optional Beeper track  | One `playPattern()` call                 | `BeeperPatternHandle.setGain()` and `stop()`                 |
| PSG register dump      | `loadPSG()` then one `playAYDump()` call | `AYDumpHandle.setChannelGain()`, `setStereo()`, and `stop()` |
| Sanitka procedural SFX | Local Web Audio sawtooth oscillator      | Local effect handle with per-phase gains and `stop()`        |

`scripts/playback-adapter.js` does not synthesise or reinterpret audio. It gives the UI one small control surface and routes A/B/C/BEEPER gain, stereo, and stop operations to the active upstream handles. MUTE/SOLO policy, per-song volume storage, monitor state, and RESET MIX remain local application concerns.

`scripts/playback-clock.js` aims AY and Beeper scheduling at one audio-clock start target, then keeps the monitor and completion polling on `AudioContext.currentTime` so a suspended context does not let the UI run ahead. Playback waits for the user-initiated `AudioContext.resume()` Promise before any source is scheduled.

The first PSG AudioWorklet setup is serialized through `scripts/playback-queue.js`. A queued request that has already been cancelled is discarded before it can create a node; an in-flight setup starts muted and is unmuted only after its handle is adopted by the current playback.

There is no local AY/noise/envelope renderer, Beeper scheduler, PSG channel isolator, or parallel PSG chip bank. Sanitka is the sole procedural audio exception: it is documented as a **procedural Web Audio effect** because its Doppler siren uses a local sawtooth oscillator rather than AY emulation.

`AudioContext` is never created at module import or page load. `initAudio()` runs synchronously from the Play click handler, and every playback path starts only after that user gesture, preserving browser autoplay requirements.

## Built-in Catalogue

The generated catalogue contains exactly twenty-three items. Every item carries its 2026 catalogue release, original date or creation date, source provenance, and complete rights record.

| ID                      | Display title                    | Playback source / layout    |
| ----------------------- | -------------------------------- | --------------------------- |
| `arctic_circuit`        | Arctic Circuit                   | JSON AY, ACB + 1-bit Beeper |
| `ay_soundcheck`         | AY Soundcheck                    | JSON AY + 1-bit Beeper      |
| `bitshift_boulevard`    | Bitshift Boulevard               | JSON AY, ABC                |
| `blue_danube`           | The Blue Danube                  | JSON AY, ABC                |
| `brahms_lullaby`        | Brahms' Lullaby                  | JSON AY, ABC                |
| `chaosbunny_escape`     | Chaosbunny Escape                | JSON AY arrangement         |
| `frere_jacques`         | Frère Jacques                    | JSON AY, ABC                |
| `greensleeves`          | Greensleeves                     | JSON AY, ACB + 1-bit Beeper |
| `hall_of_mountain_king` | In the Hall of the Mountain King | JSON AY, ACB + 1-bit Beeper |
| `infernal_galop`        | Infernal Galop (Can-Can)         | JSON AY, ABC + 1-bit Beeper |
| `korobeiniki`           | Korobeiniki (Tetris Theme A)     | JSON AY arrangement         |
| `midnight_power_play`   | Midnight Power Play              | JSON AY, ACB + 1-bit Beeper |
| `minuet_in_g`           | Minuet in G Major                | JSON AY, ACB                |
| `nad_tatrou_sa_blyska`  | Nad Tatrou sa blýska             | JSON AY arrangement         |
| `neon_warren`           | Neon Warren                      | JSON AY, ABC + 1-bit Beeper |
| `ode_to_joy`            | Ode to Joy                       | JSON AY arrangement         |
| `one_bit_night_shift`   | One-Bit Night Shift              | JSON 1-bit Beeper only      |
| `orbital_foundry`       | Orbital Foundry                  | JSON AY, ACB                |
| `signal_over_tatras`    | Signal over Tatras               | JSON AY, ACB + 1-bit Beeper |
| `stereo_ambulance`      | Sanitka (Doppler)                | Procedural Web Audio effect |
| `tilebound_rabbit`      | Tilebound Rabbit                 | JSON AY, ABC                |
| `turkish_march`         | Turkish March                    | JSON AY, ACB + 1-bit Beeper |
| `wilhelmus`             | Wilhelmus                        | JSON AY arrangement         |

### AY Soundcheck

AY Soundcheck is a deterministic 31-second public signal-path diagnostic. All four timelines are aligned to exactly 31,000 ms:

- 0–2 s: channel A, C3, left;
- 2–4 s: channel B, E4, centre;
- 4–6 s: channel C, G5, right;
- 6–8 s: continuous Beeper A5;
- 8–11 s: C3/E4/G4 three-voice chord;
- 11–14 s: channel B, A4, envelope shape 13 with a 25 ms attack cycle and sustained hold;
- 14–18 s: separated left and right pulses;
- 18–22 s: constant A4 swept left→right→left;
- 22–30 s: DnB mini-mix with bass, AY noise, alternating stabs, and Beeper hi-hats;
- 30–31 s: control silence.

## Adding a JSON Song

1. Copy `songs/_new_song.json.example` to a new filename, for example `songs/moon_run.json`.
2. Set a unique `id`, title, artist, description, catalogue/rights metadata, patterns, and arrangements.
3. Run:

   ```bash
   npm run build
   ```

4. Reload the player. The new song appears in the cover library automatically.

The browser cannot enumerate files in `songs/` by itself. `scripts/generate-song-library.mjs` solves this by collecting every real `*.json` song file, excluding `songs/index.json`, and generating the catalogue consumed by the player.

`_new_song.json.example` is deliberately ignored by the generator because it does not have a `.json` extension.

## Adding PSG / PT3 Music

PSG is the runtime format for real AY scene music in this player. Put a `.psg` file into `songs/`, run `npm run build`, reload the page, and the file appears in the cover library. At runtime the player calls upstream `loadPSG()` and passes the parsed dump to one upstream `playAYDump()` instance; its A/B/C gains are controlled through the returned handle.

PT3 is not directly playable at runtime. Keep `.pt3` files in `songs/` as source material — `npm run build` (via `npm run songs:convert`, `scripts/PT3PSGConverter.mjs`) renders them to `.psg` register dumps in `songs/generated/`, which the player then lists like any other PSG file. Native runtime PT3 playback still belongs in a future `zx-kit` `pt3.ts` module built on top of `AYChipCore`, not in `zxplayer`.

Binary music metadata lives in an optional JSON sidecar. For `demo.psg`, the generator first looks for `demo.psg.meta.json` and then `demo.meta.json`. A PT3 source follows the same convention; its metadata is copied to the uniquely named generated output as `<output>.psg.meta.json` during conversion.

## Catalogue Metadata and Rights

Each song may include an additive `catalog` block. It informs the listener how the checked-in source reaches the browser runtime; it does not add a runtime format picker or converter.

```json
{
  "catalog": {
    "releaseYear": 2026,
    "originalDate": "1824",
    "cover": "/assets/covers/my_new_song/cover.png",
    "audio": {
      "sourceFormat": "json-notes",
      "runtimeFormat": "zx-kit-playback",
      "chip": "AY-3-8910"
    },
    "rights": {
      "composition": {
        "status": "public-domain-eu",
        "label": "Historical composition; catalogued as public domain in the EU. This is not legal advice.",
        "evidenceUrl": "https://example.com/authoritative-source",
        "legalBasisUrl": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=LEGISSUM%3Al26032"
      },
      "arrangement": {
        "status": "all-rights-reserved",
        "label": "AY arrangement © 2026 Your name. All rights reserved.",
        "holder": "Your name"
      },
      "source": {
        "status": "all-rights-reserved",
        "label": "Song source © 2026 Your name. All rights reserved.",
        "holder": "Your name"
      },
      "cover": {
        "status": "all-rights-reserved",
        "label": "Cover artwork © 2026 Your name. All rights reserved.",
        "holder": "Your name"
      }
    }
  }
}
```

Supported rights statuses are `public-domain-eu`, `all-rights-reserved`, `licensed`, and `unverified`. The catalogue generator derives `rightsStatus`; do not author it manually. A song remains playable when any category is unverified, but the player opens a prominent **RIGHTS UNVERIFIED** warning. Rights metadata documents the available evidence and is not a substitute for legal advice.

Missing covers use `/assets/covers/fallback/cover.png`. Native web covers are 256×192 PNG files; the accompanying 6912-byte SCR file is the hardware-authentic ZX Spectrum source and `cover-4x.png` is a nearest-neighbour preview.

## Song Format

A song with `schemaVersion: 1` contains three required AY channel definitions: `A`, `B`, and `C`. It may additionally contain an optional top-level `beeper` track. This is an additive schema extension: existing version 1 songs remain valid and silent on the beeper path.

```json
{
  "schemaVersion": 1,
  "id": "my_new_song",
  "title": "My New Song",
  "artist": "Your name",
  "description": "A short description.",
  "ay": {
    "pan": { "A": -0.4, "B": 0, "C": 0.4 }
  },
  "channels": {
    "A": {
      "label": "BASS",
      "patterns": {
        "bassPattern": {
          "notes": "C2 r C2 r",
          "options": { "dur": 180, "vol": 10 }
        }
      },
      "arrangement": [{ "pattern": "bassPattern", "repeat": 8 }]
    },
    "B": {
      "label": "LEAD",
      "patterns": {
        "leadPattern": {
          "notes": "C4 E4 G4 E4",
          "options": { "dur": 180, "envShape": 13, "envCycleDurMs": 20 }
        }
      },
      "arrangement": [{ "pattern": "leadPattern", "repeat": 8 }]
    },
    "C": {
      "label": "AY EVENTS",
      "patterns": {
        "eventPattern": {
          "options": { "dur": 180, "vol": 8 },
          "events": [
            { "note": "C3" },
            { "note": "r" },
            { "freq": 196, "dur": 360, "envShape": 10, "envCycleDurMs": 90 },
            { "note": "r", "dur": 360 }
          ]
        }
      },
      "arrangement": [{ "pattern": "eventPattern", "repeat": 8 }]
    }
  },
  "beeper": {
    "label": "ONE-BIT ACCENTS",
    "pan": 0,
    "patterns": {
      "accentPattern": {
        "options": { "dur": 40 },
        "events": [{ "freq": 1200 }, { "note": "r", "dur": 680 }]
      }
    },
    "arrangement": [{ "pattern": "accentPattern", "repeat": 8 }]
  }
}
```

### AY Pattern Fields

| Field                   | Meaning                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `ay.pan.A/B/C`          | Optional channel pan from `-1` (left) through `0` (centre) to `1` (right).               |
| `notes`                 | A `zx-kit` `seq()` string. Tokens accept `Note` or `Note:durMs`; `r` is a rest.          |
| `events`                | Alternative full AY event array. Use exactly one of `notes` or `events` in each pattern. |
| `options.dur`           | Default step/event duration in milliseconds.                                             |
| `options.vol`           | AY amplitude `0–15`. Ignored when an envelope is active.                                 |
| `options.noise`         | Mixes the shared AY LFSR noise generator into the event.                                 |
| `options.noisePeriod`   | AY noise period `1–31` (R6); higher values sound darker.                                 |
| `options.envShape`      | AY hardware envelope shape `0–15` (R13).                                                 |
| `options.envCycleDurMs` | Duration of one envelope ramp in milliseconds.                                           |
| `pan`                   | Static pattern pan from `-1` (left) through `0` (centre) to `1` (right).                 |
| `sweep.from/to`         | Continuous pattern pan sweep; both endpoints must be within `-1..1`.                     |
| `arrangement[].pattern` | Name of a pattern declared in the same channel.                                          |
| `arrangement[].repeat`  | Number of consecutive repetitions. Defaults to `1`.                                      |

`options` supplies defaults for every note in a pattern. A compact `notes` pattern is parsed by `zx-kit`'s `seq()` and then receives the additional AY fields. An `events` pattern maps directly to `AYNote[]`; every event accepts either a note name or a raw frequency:

```json
{
  "options": { "dur": 180, "vol": 9 },
  "events": [
    { "note": "C4" },
    { "note": "E4", "dur": 360, "vol": 12 },
    { "freq": 392, "envShape": 10, "envCycleDurMs": 90 },
    { "note": "r", "dur": 540 }
  ]
}
```

Event values override pattern defaults. `note` and `freq` are mutually exclusive. Noise-only events use a rest frequency together with noise, for example `{ "note": "r", "noise": true, "noisePeriod": 24 }`.

The player compiles pattern `pan` and `sweep` data into upstream `AYNote.pan`/`panTo` automation. Changing MONO/ACB/ABC while a JSON song is playing deliberately takes manual control: `AYHandle.setStereoMode()` cancels future authored pan automation for that playback, and the monitor switches to the selected preset as well.

### Optional Beeper Track

`beeper` is a sibling of `channels`, not an AY option and not a fourth AY register channel. It uses the same named-pattern and arrangement model, but its notes support only frequency and duration. `beeper.pan` sets the stereo position for the entire beeper track.

```json
{
  "beeper": {
    "label": "PERCUSSION",
    "pan": 0,
    "patterns": {
      "hitAndRest": {
        "options": { "dur": 40 },
        "events": [{ "freq": 1200 }, { "note": "r", "dur": 680 }]
      }
    },
    "arrangement": [{ "pattern": "hitAndRest", "repeat": 8 }]
  }
}
```

| Field                   | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `beeper.label`          | Optional monitor label.                                                        |
| `beeper.pan`            | Track pan from `-1` (left) through `0` (centre) to `1` (right).                |
| `notes`                 | Compact note/rest sequence with optional `:durMs` token durations.             |
| `events`                | Explicit events containing exactly one of `note` or `freq`, plus optional dur. |
| `options.dur`           | Default beeper event duration; defaults to 200 ms.                             |
| `arrangement[].pattern` | Pattern declared in `beeper.patterns`.                                         |
| `arrangement[].repeat`  | Number of repetitions; defaults to `1`.                                        |

Short hits should be followed by an explicit rest so their duration and rhythmic spacing remain independent. AY-only fields such as `vol`, `noise`, and `envShape` are rejected in beeper options.

The player passes the complete beeper timeline to upstream `playPattern()` against the same `AudioContext` clock as `playAY()`. Its isolated pattern handle makes MUTE, SOLO, the Beeper volume fader, and Stop effective without touching AY registers or unrelated Beeper effects. AY playback is stopped independently through its own upstream handle; a Beeper-only song does not create an AY handle at all.

## Live Audio Monitor

While a song is playing, each channel card shows:

- the current named pattern;
- its current repeat pass;
- the current sequence step and note token;
- whether the current step is **TONE**, **NOISE**, **TONE + NOISE**, **BEEP**, or **REST**;
- its effective `VOL`, envelope shape (`ENV`), and noise period (`NP`);
- a flashing active state when that channel is producing tone or noise.

The monitor is derived from the same generated pattern timeline used for playback. It is not an audio analyser, so its labels stay deterministic and directly map back to the JSON arrangement. Songs without a `beeper` section show the fourth card as `UNUSED`.

Each available card has **MUTE** and **SOLO** buttons. SOLO is exclusive: selecting one channel temporarily suppresses every other available channel, including the independent beeper. Selecting the same SOLO again restores the stored MUTE states. Pressing MUTE on the current solo channel exits SOLO and leaves that channel muted. Unavailable channels, such as Beeper in a three-channel song, have disabled controls.

The volume fader on each card changes only that channel and does not toggle MUTE, including at 0%. The four values are stored per song under `zxplayer.channelVolumes.v1`; **RESET MIX** restores the selected song to 100% without changing MUTE or SOLO.

Keyboard shortcuts use `1`–`4` for MUTE and `Shift+1`–`Shift+4` for SOLO (A, B, C, Beeper). `S` cycles the stereo mode and `Space` starts or stops playback. Shortcuts stay inactive while focus is on an interactive control and never consume Ctrl/Cmd/Alt-modified keystrokes.

## Creating a Source Archive

Create a compact, dated archive of the current project state:

```bash
npm run archive
```

The command first runs `npm run build`, ensuring that `songs/index.json` matches the available songs. It then creates a ZIP in `archive/` with a date-based filename, for example:

```text
archive/zxplayer-2026-06-25.zip
```

If an archive already exists for that date, the script creates a numbered sibling instead of overwriting it:

```text
archive/zxplayer-2026-06-25-02.zip
```

The archive deliberately excludes:

```text
archive/
node_modules/
.git/
coverage/
.DS_Store
```

This keeps backups small, prevents a ZIP from containing older ZIPs, and avoids copying dependencies or Git internals.

## Git and Repository Hygiene

The project includes the following repository-level files:

- `.gitattributes` normalises text files to LF line endings across Windows, macOS, and Linux.
- `.prettierrc` defines the canonical formatter settings: LF endings, single quotes, and a 120-character print width.
- `.gitignore` keeps local-only and generated machine artefacts out of commits.

`package-lock.json` should be committed. It makes dependency installation reproducible with `npm ci`.

`songs/index.json` should also remain committed. It is generated, but it is required by the deployed static player. Run `npm run build` before committing any song library change so the catalogue remains accurate.

Typical first commit sequence:

```bash
git init
git add .
git commit -m "feat: initialise zx-kit player"
```

Before a normal commit, use:

```bash
npm run format:check
npm test
npm run build
git status
```

## Troubleshooting

### The song list does not load

Serve the project through HTTP. Do not open `index.html` through `file://`.

### A new song is missing from the cover library

Check that the file:

- is inside `songs/`;
- ends with `.json`;
- is not named `index.json`;
- contains valid JSON with at least `id`, `title`, and `channels`;
- was followed by `npm run build`.

### The page loads but there is no sound

Select a song and press **Play** manually. Browser autoplay policy blocks Web Audio until a user gesture takes place.

### A song shows “Invalid song JSON”

Every AY channel `A`, `B`, and `C` must contain a `patterns` object and an `arrangement` array. Every arrangement entry must refer to a pattern defined in that same channel. If present, `beeper` must also contain its own `patterns` and `arrangement`.

## Development Notes

The frontend is intentionally simple: static HTML, CSS, and ES modules. The player is kept data-driven so new music generally requires adding only a JSON file, not changing playback code.

Browser code imports `zx-kit` only through `scripts/zx-kit.js`, whose complete contents pin the same exact version as `package.json`:

```js
export * from 'https://cdn.jsdelivr.net/npm/zx-kit@0.45.0/dist/index.js';
```

Update npm, the lockfile, and this wrapper together. `npm test` rejects version drift or any second JavaScript source containing a `zx-kit` CDN URL.
