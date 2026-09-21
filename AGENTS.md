# AGENTS.md

Pokyny a pravidlá pre AI agentov pracujúcich v repozitári `zxplayer`.

**Tento súbor je jediným zdrojom pravdy (single source of truth) pre zxplayer.**

---

## 1. Prehľad projektu a rozsah

`zxplayer` je odľahčený, dátovo orientovaný webový prehrávač hudby pre 3-kanálový zvukový čip **AY-3-8910 / AY-3-8912** (a YM2149) z čias počítačov ZX Spectrum 128K / Didaktik Melodik, s voliteľnou paralelnou 1-bitovou beeper stopou.

Prehrávač je postavený na knižnici [`zx-kit`](https://www.npmjs.com/package/zx-kit).

| Vlastnosť          | Hodnota                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| Balík              | `zx-kit-player` (súkromný projekt)                                                 |
| Engine             | Node.js `>=22`                                                                     |
| Modulový formát    | ESM (`"type": "module"`)                                                           |
| Runtime závislosti | Žiadne frameworky (čistý HTML5, Vanilla CSS, moderný ES JavaScript, Web Audio API) |
| Dev závislosti     | `zx-kit` (0.45.0), `vite`, `prettier`, `zip-lib`                                   |
| Pridružený projekt | `~/Projects/retro/engine/zx-kit` — **STRIKTNE READ-ONLY!**                         |

---

## 2. Kritické pravidlo: `zx-kit` je READ-ONLY

> [!CAUTION]
> Priečinok `~/Projects/retro/engine/zx-kit` (a akékoľvek súbory v ňom) je **STRIKTNE READ-ONLY**.
> Žiadny agent nesmie meniť súbory v `zx-kit`, pridávať doň kód, ani v ňom spúšťať príkazy modifikujúce repozitár.
> Všetky zmeny, nový kód, štýly, skripty a skladby patria výhradne do repozitára `zxplayer`.

---

## 3. Reprezentácia hudby a AY architektúra v `zx-kit`

`zxplayer` využíva 3 spôsoby práce so zvukom, ktoré `zx-kit` poskytuje:

### 1. Notový zápis (`music.ts`)

- Symbolický notový zápis nôt podľa názvov: `A4`, `C#5`, `Bb3`, `r` (pomlka), voliteľne s dĺžkou `C4:400`.
- Rovnomerné temperované ladenie cez `noteToFreq()`.
- Rýchla tvorba patternov cez `seq('C4 E4 G4 E4', { dur: 180 })`.
- Jednoduché slučky na pozadí cez `playAYLoop()`.

### 2. Príkazový a syntetický zápis (`ay.ts` & `audio.ts`)

- Presná definícia každého tónu pomocou objektov `AYNote`:
  - `freq`: frekvencia v Hz (`0` = ticho / pomlka)
  - `dur`: dĺžka v milisekundách
  - `vol`: hlasitosť `0–15` (hardvérová logaritmická škála `AY_VOL`)
  - `noise`: `true` / `false` (zmiešanie hardvérového šumového generátora LFSR)
  - `noisePeriod`: `1–31` (register R6, vyššia hodnota = temnejší šum)
  - `envShape`: tvar hardvérovej obálky `0–15` (register R13)
  - `envCycleDurMs`: perióda jedného cyklu obálky v ms (registre R11-R12)
  - `pan` / `panTo`: statická stereo poloha alebo sweep konkrétnej noty
- `playAY()` vracia ovládateľný handle s `setChannelGain()`, `setChannelPan()`, `setStereoMode()` a `stop()`.
- Interaktívne ovládanie čipu v reálnom čase cez `createAY()` / `AYChip` (`tone`, `enableNoise`, `envelope`, `mute`, `pan`, `setStereoMode`, `volume`, `fade`, `stop`).
- **Nezávislá 1-bit beeper stopa**: `playPattern()` vracia izolovaný handle s `setGain()` a `stop()`; krátke SFX môže vytvoriť `beep(freq, durMs)`. Beeper hrá paralelne s AY bez ovplyvnenia AY registrov.

### 3. Registrové dumpy PSG a AudioWorklet emulácia (`aydump.ts`)

- Hardvérovo presná (sample-accurate) emulácia čipu cez `AYChipCore` bežiaci priamo v `AudioWorklet`.
- Formát `.psg`: surový prúd hodnôt registrov R0–R13 zapisovaných na 50 Hz frekvencii.
- Prehrávanie cez `loadPSG()` / `parsePSG()` / jedno `playAYDump()` jadro s live gainom A/B/C a stereo ovládaním.
- Hardvérové profily (`AY_MACHINE`):
  - `zx128` (1.7734 MHz, mono)
  - `melodik` (1.75 MHz, ACB stereo)
  - `pentagon` (1.75 MHz, ACB stereo)
  - `atariST` (2.0 MHz, YM2149, mono)
- **Offline konverzia PT3 → PSG**: ProTracker 3 súbory (`.pt3`) sú zdrojovým materiálom v `songs/`, ktoré skript `PT3PSGConverter.mjs` konvertuje na `.psg` do `songs/generated/`.

---

## 4. Štruktúra repozitára

```text
.
├── assets/
│   └── screenshot.png
├── scripts/
│   ├── PT3PSGConverter.mjs        # Konvertor PT3 tracker súborov na PSG register dumps
│   ├── archive-project.mjs        # Vytvorenie záložného ZIP archívu
│   ├── bunny.js                   # Demo ZX sprite animácie
│   ├── generate-song-library.mjs  # Generátor katalógu songs/index.json
│   ├── player.js                  # Hlavná logika prehrávača, Web Audio, monitor, UI
│   └── validate-songs.mjs         # Validačný test všetkých JSON skladieb cez zx-kit
├── songs/
│   ├── _new_song.json.example     # Vzorová šablóna pre novú JSON skladbu
│   ├── generated/                 # Vygenerované PSG dumpy z PT3 súborov (gitignored)
│   ├── *.json                     # Zdrojové skladby v JSON formáte
│   ├── *.psg                      # Raw PSG register dumpy
│   ├── *.pt3                      # Zdrojové PT3 tracker moduly
│   └── index.json                 # Generovaný index skladieb pre prehrávač
├── AGENTS.md                      # Tento dokument s pravidlami pre agentov
├── index.html                     # Hlavné HTML rozhranie prehrávača
├── package.json                   # Konfigurácia npm skriptov a závislostí
├── README.md                      # Dokumentácia pre používateľov
├── sprite.html                    # Demo stránka pre ZX sprite
└── style.css                      # Retro ZX Spectrum vizuálny štýl
```

---

## 5. Vývojové a overovacie príkazy

| Príkaz                   | Popis                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `npm run songs:convert`  | Konvertuje všetky `.pt3` súbory v `songs/` na `.psg` do `songs/generated/`. |
| `npm run songs:generate` | Preskúma `songs/` a vygeneruje katalóg `songs/index.json`.                  |
| `npm run songs:validate` | Skompiluje a overí každú JSON skladbu voči inštalovanej `zx-kit`.           |
| `npm run build`          | Spustí celý build pipeline: `convert` → `generate` → `validate`.            |
| `npm run dev`            | Spustí lokálny vývojový server cez Vite.                                    |
| `npm run format`         | Naformátuje kód cez Prettier.                                               |
| `npm run format:check`   | Skontroluje formátovanie kódu.                                              |
| `npm run site`           | Spustí build a poskladá nasadzovateľnú stránku do `_site/`.                 |
| `npm run archive`        | Vytvorí datovaný ZIP archív projektu v `archive/`.                          |

---

## 5a. CI a nasadenie

Každý push do `main` spúšťa `.github/workflows/ci-deploy.yml`; stránka na GitHub Pages sa publikuje z toho, čo ten beh vyrobí. Pull request prejde rovnakými kontrolami, ale nenasadzuje nič.

| Krok   | Čo beží                                                                     | Kedy zlyhá                                                                                     |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Verify | `format:check` → `test` → `build` → `git diff --exit-code songs/index.json` | Neformátovaný kód, padnutý test, neplatná skladba, alebo **necommitnutý vygenerovaný katalóg** |
| Build  | `npm run site`                                                              | Chýba súbor, bez ktorého sa stránka nenačíta                                                   |
| Deploy | `_site/` → GitHub Pages                                                     | Len na `main`                                                                                  |

**Pravidlá pre agenta:**

1. Po každej zmene v `songs/` spusti `npm run build` a **commitni aj `songs/index.json`** — inak CI padne na kroku `git diff`.
2. Pred commitom spusti `npm run format` (nie iba `format:check`) — CI formátovanie neopravuje, iba ho kontroluje.
3. Ak pridávaš nový súbor, ktorý stránka načítava za behu, dopíš ho do `CONTENT` alebo `REQUIRED` v `scripts/build-site.mjs`. Nasadzuje sa len to, čo je v tom zozname.
4. `_site/` je vygenerovaný adresár — je v `.gitignore` a nikdy sa necommituje.

---

## 6. Pravidlá a obmedzenia pri úpravách

1. **Čistý vanilla kód bez frameworkov**:
   - Nepridávať React, Vue, Tailwind ani iné ťažké závislosti.
   - Používať moderný vanilla JavaScript (ES modules) a prehľadné vanilla CSS.
2. **Web Audio & Autoplay politika prehliadačov**:
   - `AudioContext` sa nesmie inicializovať pri importe modulu ani pri načítaní stránky.
   - Inicializácia (`initAudio()`, `resumeAudio()`) musí prebehnúť výhradne v reakcii na používateľské gesto (kliknutie na Play, výber skladby a pod.).
3. **Overovanie audia**:
   - Agenti v bezhlavom prostredí (headless / CLI) **nepočujú zvuk**.
   - Zvuk a vizuálna správnosť sa overujú syntaktickou validáciou (`npm run build`), správnosťou dátových tokov a manuálnym posluchom používateľa.
4. **Formátovanie kódu**:
   - Dodržiavať nastavenia v `.prettierrc`: `singleQuote: true`, LF konce riadkov, `printWidth: 120`.
   - Pred dokončením úlohy vždy spustiť `npm run format` a `npm run build`.
