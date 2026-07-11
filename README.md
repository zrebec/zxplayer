# ZX-KIT Player

A lightweight, data-driven browser player for three-channel AY music written with [`zx-kit`](https://www.npmjs.com/package/zx-kit).

Songs can be hand-authored JSON arrangements or PSG register dumps. JSON songs build three AY tracks—channels **A**, **B**, and **C**—from named patterns and arrangements. PSG songs use `zx-kit` 0.37 `aydump` playback for raw AY chip register streams.

![ZX-KIT Player screenshot](assets/screenshot.png)

## Features

- One JSON file per song in `songs/`.
- PSG register-dump playback through `zx-kit` `loadPSG()` / `playAYDump()`.
- PT3 files are listed as source material and must be converted offline to PSG before playback.
- Automatically generated song catalogue for the dropdown menu.
- Separate **Play** and **Stop** controls.
- Live AY monitor for channels A, B, and C.
- Pattern-level timeline visualisation: active pattern, pass number, note step, token, and tone/noise/rest state.
- No frontend build tool or framework required.
- Formatting enforced with Prettier.
- Reproducible source archives via `npm run archive`.

## Requirements

- Node.js 18 or newer.
- A modern browser with ES modules, `fetch()`, Web Audio support, and JavaScript enabled.
- An HTTP server for local development. Opening the page directly with `file://` will not work because browsers block JSON loading via `fetch()` in that context.

The player imports the pinned `zx-kit` module from jsDelivr at runtime. The browser therefore needs internet access when the player is opened, unless you later replace that CDN import with a locally bundled copy.

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

| Command                  | Purpose                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `npm run songs:generate` | Scans song JSON files and writes `songs/index.json`.                                 |
| `npm run build`          | Runs the song catalogue generator. Use it after adding, renaming, or removing songs. |
| `npm run format`         | Formats the project with Prettier.                                                   |
| `npm run format:check`   | Checks whether the project already matches the configured Prettier style.            |
| `npm run archive`        | Regenerates the song catalogue, then creates a dated source ZIP in `archive/`.       |

## Project Structure

```text
.
├── assets/
│   └── screenshot.png
├── scripts/
│   ├── archive-project.mjs
│   ├── generate-song-library.mjs
│   └── player.js
├── songs/
│   ├── _new_song.json.example
│   ├── chaosbunny_escape.json
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

## Adding a JSON Song

1. Copy `songs/_new_song.json.example` to a new filename, for example `songs/moon_run.json`.
2. Set a unique `id`, title, artist, description, patterns, and arrangements.
3. Run:

   ```bash
   npm run build
   ```

4. Reload the player. The new song appears in the dropdown automatically.

The browser cannot enumerate files in `songs/` by itself. `scripts/generate-song-library.mjs` solves this by collecting every real `*.json` song file, excluding `songs/index.json`, and generating the catalogue consumed by the player.

`_new_song.json.example` is deliberately ignored by the generator because it does not have a `.json` extension.

## Adding PSG / PT3 Music

PSG is the runtime format for real AY scene music in this player. Put a `.psg` file into `songs/`, run `npm run build`, reload the page, and the file appears in the dropdown with a `[PSG]` suffix.

PT3 is not directly playable at runtime. Keep `.pt3` files in `songs/` as source material — `npm run build` (via `npm run songs:convert`, `scripts/PT3PSGConverter.mjs`) renders them to `.psg` register dumps in `songs/generated/`, which the player then lists like any other PSG file. Native runtime PT3 playback still belongs in a future `zx-kit` `pt3.ts` module built on top of `AYChipCore`, not in `zxplayer`.

## Song Format

A song reserves `schemaVersion: 1` for future compatibility and contains three AY channel definitions: `A`, `B`, and `C`.

```json
{
  "schemaVersion": 1,
  "id": "my_new_song",
  "title": "My New Song",
  "artist": "Your name",
  "description": "A short description.",
  "channels": {
    "A": {
      "label": "BASS",
      "patterns": {
        "bassPattern": {
          "notes": "C2 r C2 r",
          "options": { "dur": 180 }
        }
      },
      "arrangement": [{ "pattern": "bassPattern", "repeat": 8 }]
    },
    "B": {
      "label": "LEAD",
      "patterns": {
        "leadPattern": {
          "notes": "C4 E4 G4 E4",
          "options": { "dur": 180 }
        }
      },
      "arrangement": [{ "pattern": "leadPattern", "repeat": 8 }]
    },
    "C": {
      "label": "DRUMS",
      "patterns": {
        "drumPattern": {
          "notes": "r C2 r C2",
          "options": { "dur": 180, "noise": true, "noisePeriod": 24 }
        }
      },
      "arrangement": [{ "pattern": "drumPattern", "repeat": 8 }]
    }
  }
}
```

### Pattern Fields

| Field                   | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `notes`                 | A `zx-kit` `seq()` note string. `r` represents a rest.           |
| `options.dur`           | Duration of each note step in milliseconds.                      |
| `options.noise`         | Enables AY noise for the pattern.                                |
| `options.noisePeriod`   | AY noise period, normally in the range `1–31` (register R6).     |
| `arrangement[].pattern` | Name of a pattern declared in the same channel.                  |
| `arrangement[].repeat`  | Number of consecutive repetitions. Defaults to `1` when omitted. |

The player constructs the actual AY note arrays by passing each pattern's `notes` and `options` to `zx-kit`'s `seq()` function.

## Live AY Monitor

While a song is playing, each channel card shows:

- the current named pattern;
- its current repeat pass;
- the current sequence step and note token;
- whether the current step is **TONE**, **NOISE**, **TONE + NOISE**, or **REST**;
- a flashing active state when that channel is producing tone or noise.

The monitor is derived from the same generated pattern timeline used for playback. It is not an audio analyser, so its labels stay deterministic and directly map back to the JSON arrangement.

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
archive/chaosbunny-2026-06-25-02.zip
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
npm run build
git status
```

## Troubleshooting

### The song list does not load

Serve the project through HTTP. Do not open `index.html` through `file://`.

### A new song is missing from the dropdown

Check that the file:

- is inside `songs/`;
- ends with `.json`;
- is not named `index.json`;
- contains valid JSON with at least `id`, `title`, and `channels`;
- was followed by `npm run build`.

### The page loads but there is no sound

Select a song and press **Play** manually. Browser autoplay policy blocks Web Audio until a user gesture takes place.

### A song shows “Invalid song JSON”

Every channel `A`, `B`, and `C` must contain a `patterns` object and an `arrangement` array. Every arrangement entry must refer to a pattern defined in that same channel.

## Development Notes

The frontend is intentionally simple: static HTML, CSS, and ES modules. The player is kept data-driven so new music generally requires adding only a JSON file, not changing playback code.

`zx-kit` is currently imported from:

```text
https://cdn.jsdelivr.net/npm/zx-kit@0.37.0/dist/index.js
```

Update that version only after validating the player with the target release.
