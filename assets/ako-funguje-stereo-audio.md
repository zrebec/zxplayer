# Ako funguje stereo zvuk v ZX-KIT Player

> Polopatický sprievodca od úplného začiatočníka po stredne pokročilého.
> Pre niekoho, kto **nemá hudobný sluch** a **nikdy nerobil zvuk v kóde**.
> Čítaj pokojne po častiach. Každý pojem najprv vysvetlím cez prirovnanie.

## Obsah

1. [Ako vôbec počítač vyrobí zvuk](#1-ako-vôbec-počítač-vyrobí-zvuk)
2. [Štyri „krabičky", z ktorých skladáme zvuk](#2-štyri-krabičky-z-ktorých-skladáme-zvuk)
3. [Obálka — ako sa hlasitosť mení v čase](#3-obálka--ako-sa-hlasitosť-mení-v-čase)
4. [Z čoho sa skladá náš prehrávač](#4-z-čoho-sa-skladá-náš-prehrávač)
5. [Dva spôsoby, akými robíme zvuk](#5-dva-spôsoby-akými-robíme-zvuk)
6. [Rozbor JSON: sanitka (efekt)](#6-rozbor-json-sanitka-efekt)
7. [KDE SÚ HLASITOSTI](#7-kde-sú-hlasitosti)
8. [Rozbor JSON: bežná skladba (noty + pan)](#8-rozbor-json-bežná-skladba-noty--pan)
9. [Kde sa s tým môžem hrať (ťahák)](#9-kde-sa-s-tým-môžem-hrať-ťahák)
10. [Sprav si Drum & Bass so striedaním na uši](#10-sprav-si-drum--bass-so-striedaním-na-uši)
11. [Čo z toho prejde do zx-kit a čo nie](#11-čo-z-toho-prejde-do-zx-kit-a-čo-nie)
12. [Ľahšie: natvrdo noty, alebo naučiť zx-kit čítať JSON?](#12-ľahšie-natvrdo-noty-alebo-naučiť-zx-kit-čítať-json)
13. [Ako to po presune otestovať](#13-ako-to-po-presune-otestovať)
14. [Slovníček](#14-slovníček)

---

## 1. Ako vôbec počítač vyrobí zvuk

Zvuk je **chvenie vzduchu**. Reproduktor (alebo membránka v AirpodE) sa hýbe tam a späť
a tlačí vzduch — to chvenie ti dorazí do ucha. Vyššie/rýchlejšie chvenie = **vyšší tón**,
pomalšie = **hlbší tón**.

Počítač zvuk „vyrobí" tak, že **mnohotisíckrát za sekundu** povie membráne, kam sa má posunúť.
My to našťastie nemusíme riešiť po jednom čísle. V prehliadači je na to nástroj **Web Audio API**.

**Predstav si to ako potrubie / linku v továrni na zvuk:**

```
[ZDROJ tónu] → [úprava hlasitosti] → [kam to znie: ľavé/pravé] → [REPRODUKTOR]
```

Web Audio = z takýchto „krabičiek" (volajú sa **uzly**, anglicky _nodes_) si poskladáš linku
a pospájaš ich „káblami" (v kóde príkaz `.connect(...)`). Úplne ako moduly na syntetizátore.

---

## 2. Štyri „krabičky", z ktorých skladáme zvuk

| Krabička (uzol)            | Čo robí                                                              | Prirovnanie                                               |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| **Oscillator** (oscilátor) | Vyrába samotný tón. Má **frekvenciu** v Hz (Hertz) = výška tónu.     | Struna / píšťala. Vyššie číslo Hz = vyšší tón.            |
| **GainNode**               | Riadi **hlasitosť**. `gain = 0` ticho, `gain = 1` plno.              | Kohútik / koliesko hlasitosti.                            |
| **StereoPannerNode**       | Riadi, **do ktorého ucha** to ide. `-1` ľavé, `0` stred, `+1` pravé. | Jedno koliesko vľavo–vpravo.                              |
| **ChannelMerger**          | Zlúči **dva samostatné signály** do ľavého a pravého kanála.         | Mixpult s dvoma vstupmi: jeden ide doľava, druhý doprava. |

A na konci je **destination** = tvoje slúchadlá/reproduktor (koniec potrubia).

Pár čísel pre predstavu o frekvencii:

- `440 Hz` = komorné „A" (referenčný tón, podľa ktorého sa ladia nástroje),
- o **oktávu vyššie** = **2×** toľko Hz (880 Hz), o oktávu nižšie = polovica (220 Hz),
- siréna sanitky u nás strieda dva tóny: `760 Hz` a `580 Hz` — to „ný-ný-ný".

### Rozdiel medzi PAN a MERGER (toto je dôležité!)

- **StereoPanner** má **jeden** ovládač. Pri `0` ide zvuk **rovnako** do oboch uší a vieš
  meniť len pomer L↔R. **Nevieš** povedať „ľavé daj nahlas a pravé potichu nezávisle".
- **ChannelMerger + dva GainNody** (jeden pre ľavé, jeden pre pravé) ti dá **nezávislé**
  hlasitosti pre každé ucho. **Toto presne robí naša sanitka.**

---

## 3. Obálka — ako sa hlasitosť mení v čase

Tón nie je len „zapnutý / vypnutý". Keď stlačíš klávesu klavíra, zvuk **rýchlo nabehne**
a potom **pomaly doznieva**. Tomuto priebehu hlasitosti v čase sa hovorí **obálka** (_envelope_).

```
hlasitosť
  ^
  |      /\
  |     /  \____
  |    /        \____
  |   /              \_____
  +--/--------------------------> čas
   nábeh   držanie     dozvuk
  (attack)            (release)
```

V kóde obálku „nakreslíme" príkazmi na koliesku hlasitosti:

- `setValueAtTime(hodnota, čas)` = „v tomto čase nastav presne túto hlasitosť",
- `linearRampToValueAtTime(hodnota, čas)` = „**plynule** do tohto času dôjdi na túto hlasitosť".

Príklad (rýchly „ping"): nahlas hneď, potom rýchlo stíchni.
Príklad (siréna): nahlas a **drž**, kým neprejde.

---

## 4. Z čoho sa skladá náš prehrávač

Projekt `zxplayer` má tieto časti:

| Súbor                               | Úloha                                                 | Prirovnanie      |
| ----------------------------------- | ----------------------------------------------------- | ---------------- |
| `index.html`                        | stránka: tlačidlá PLAY/STOP, monitor kanálov          | kostra/displej   |
| `style.css`                         | ako to vyzerá (farby, rozloženie)                     | maľovka          |
| `scripts/player.js`                 | **mozog** — číta skladbu, vyrába zvuk, kreslí monitor | dirigent         |
| `songs/*.json`                      | jednotlivé **skladby** (dáta)                         | noty na stojane  |
| `scripts/generate-song-library.mjs` | spraví zoznam skladieb do menu (`index.json`)         | obsah / register |
| **zx-kit** (z internetu)            | knižnica, čo vie z **textu nôt** spraviť AY zvuk      | zvukový engine   |

`player.js` si „požičiava" z knižnice **zx-kit** dva nástroje:

- `seq("C4 D4 E4 r", { dur: 300 })` → premení **text nôt** na zoznam tónov (frekvencia + dĺžka),
- `playAY({ a, b, c })` → tie tóny **zahrá** na troch kanáloch AY čipu (ako ZX Spectrum 128).

> **Dôležité:** zx-kit rozumie **notám**, ale **NErozumie nášmu JSON**. JSON si rozbaľuje
> náš `player.js` sám a do zx-kitu posiela až hotové noty. (K tomu sa vrátime v časti 11 a 12.)

---

## 5. Dva spôsoby, akými robíme zvuk

V prehrávači sú **dva celkom odlišné svety**:

### A) Bežná skladba (chaosbunny, ode_to_joy, four_tucs, ping-pong)

- Ide cez **zx-kit** (AY čip zvuk).
- Skladba je v JSON ako **noty** v troch kanáloch.
- **Pan** (do ktorého ucha) sme dorobili my v `player.js` (funkcia `playAYStereo`) tak, že
  každý kanál pošleme cez vlastný StereoPanner.

### B) Efekt „ambulance" (naša sanitka)

- **NEPOUŽÍVA zx-kit.** Je to **náš vlastný malý syntetizátor** vo `player.js`
  (funkcia `playAmbulance`).
- Prečo zvlášť? Lebo Doppler (klesajúca výška) + **nezávislé ľavé/pravé ucho** potrebujú
  uzly a plynulé „kreslenie" hlasitosti, ktoré AY čip takto nevie.
- Je to **zvukový efekt**, nie „pesnička" pre AY.

Toto rozlíšenie je kľúčové pre časť 11 (čo prejde do zx-kit): **pan áno, sanitka nie.**

---

## 6. Rozbor JSON: sanitka (efekt)

Toto je súbor `songs/stereo_ambulance.json`:

```json
{
  "schemaVersion": 1,
  "stereo": true,
  "effect": "ambulance",
  "id": "stereo_ambulance",
  "title": "Sanitka (Doppler)",
  "artist": "Fox",
  "description": "Stojíš pri ceste. Sanitka sa blíži sprava ...",
  "ambulance": {
    "approachMs": 4000,
    "passMs": 2800,
    "recedeMs": 5200,
    "panFrom": 1,
    "panTo": -1,
    "sirenHi": 760,
    "sirenLo": 580,
    "sirenStepMs": 560,
    "dopplerApproach": 1.06,
    "dopplerRecede": 0.9
  }
}
```

Čo znamená každý riadok:

| Pole                    | Význam                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `schemaVersion`         | verzia formátu (vždy `1`) — poistka do budúcna                                                  |
| `stereo`                | `true` = nepúšťať cez obyčajné mono, ide o stereo skladbu                                       |
| `effect`                | `"ambulance"` = použi špeciálny efekt sanitky (nie noty)                                        |
| `id`, `title`, `artist` | identifikátor, názov v menu, autor                                                              |
| `description`           | text, čo sa ukáže pod názvom                                                                    |
| `approachMs`            | ako dlho sa **blíži sprava** (4000 ms = 4 s)                                                    |
| `passMs`                | ako dlho trvá **prelet** ponad hlavu (2800 ms)                                                  |
| `recedeMs`              | ako dlho **odchádza doľava** a doznieva (5200 ms)                                               |
| `sirenHi` / `sirenLo`   | dva tóny sirény v Hz (vysoký 760, nízky 580)                                                    |
| `sirenStepMs`           | ako rýchlo strieda „ný-ný" (560 ms na jeden tón)                                                |
| `dopplerApproach`       | násobič výšky pri **približovaní** (1.06 = o 6 % vyššie)                                        |
| `dopplerRecede`         | násobič výšky pri **vzďaľovaní** (0.9 = o 10 % nižšie)                                          |
| `panFrom` / `panTo`     | _(historický zvyšok — odkedy máme nezávislé uši, tieto sa už nepoužívajú; pokojne ich ignoruj)_ |

**Doppler po našom:** keď sa zvuk **blíži**, vlny sa „stláčajú" → vnímaš ho **vyššie**.
Keď sa **vzďaľuje**, vlny sa „naťahujú" → vnímaš ho **nižšie**. Preto sirénu vynásobíme
číslom, ktoré počas preletu klesá z `1.06` na `0.9` — tón sa prepadne, presne ako v realite.

> **Pozor:** v tomto JSON **nie sú hlasitosti**. Sú v kóde — viď ďalšia časť.

---

## 7. KDE SÚ HLASITOSTI

Pre **sanitku** sú hlasitosti v `scripts/player.js` vo funkcii **`ambulanceEnvelopes(amb)`**.
Sú to dve „čiary v čase" — jedna pre **ľavé** ucho, jedna pre **pravé**:

```js
right: [           // PRAVÉ ucho: [časMs, hlasitosť]
  [0,     0.02],   // začiatok: skoro ticho
  [2400,  0.18],   // silnie (blíži sa)
  [4000,  0.40],   // koniec príchodu
  [5400,  0.46],   // stred preletu = najhlasnejšie vpravo
  [6800,  0.10],   // po prelete rýchlo padá
  [7840,  0.0001], // pravé úplne stíchne
  ...
],
left: [            // ĽAVÉ ucho
  [0,     0.0001], // počas príchodu ticho
  [4000,  0.0001],
  [5400,  0.30],   // v strede začína nabiehať
  [6800,  0.50],   // po prelete je vľavo najhlasnejšie
  [9920,  0.32],   // DLHÝ dozvuk — ľavé hrá samo
  [total, 0.0001], // úplný koniec
],
```

Čítaj to ako „v čase X má ucho hlasitosť Y, medzi bodmi plynule prejde".

- **Pravé** vyrastie, v strede je vrchol, a **rýchlo zhasne** (~7,8 s).
- **Ľavé** nabehne v strede a **doznieva dlho** sám (~do 12. sekundy).
- **„Both" (stred)** nie je tretia čiara — je to len **úsek, kde sú obe naraz hore**
  (okolo stredu preletu). Tam to znie v oboch ušiach a najhlasnejšie.

Pre **bežné skladby** (noty) je hlasitosť jedného tónu v `player.js` vo funkcii
**`applyEnvelope(...)`** (krátky „ping" alebo súvislý „whoosh"). Pan (ucho) je v JSON pri
patterne (`"pan": -1`). Viď ďalšia časť.

---

## 8. Rozbor JSON: bežná skladba (noty + pan)

Príklad zo `songs/stereo_pingpong.json` (skrátene):

```json
{
  "schemaVersion": 1,
  "stereo": true,
  "channels": {
    "A": {
      "label": "LEFT",
      "patterns": {
        "leftBips": {
          "notes": "E5 r E5 r",
          "options": { "dur": 500 },
          "pan": -1
        }
      },
      "arrangement": [{ "pattern": "leftBips" }]
    },
    "B": { "...": "..." },
    "C": { "...": "..." }
  }
}
```

Slovník pojmov v skladbe:

- **channel (kanál)** — `A`, `B`, `C`. AY čip má tri hlasy, čiže naraz môžu hrať tri linky.
- **pattern** — pomenovaný krátky úsek nôt. Napr. `leftBips`.
- **notes** — text nôt oddelený medzerami. `E5` = nota E v 5. oktáve, `r` = **pomlčka (ticho)**.
  Vyššie číslo oktávy = vyšší tón. Krížik píšeme `#` (napr. `D#2`).
- **options.dur** — koľko ms trvá **jeden krok** (každá nota/pomlčka).
- **pan** — do ktorého ucha tento pattern znie (`-1` ľavé, `0` stred, `+1` pravé).
- **sweep** — (voliteľné) plynulé presúvanie z `from` do `to` počas patternu (náš starý „prelet").
- **arrangement** — poradie, v akom sa patterny prehrajú; `"repeat": 8` = zopakuj 8×.

**Pravidlo:** počet „slov" v `notes` musí sedieť. `"E5 r E5 r"` = 4 kroky. Pri `dur: 500`
to trvá `4 × 500 = 2000 ms`.

**Ako z nôt vznikne výška?** O to sa stará zx-kit funkcia `seq(...)` — premení `"E5"` na
frekvenciu (~659 Hz). Ty nemusíš počítať Hz, stačí písať názvy nôt.

---

## 9. Kde sa s tým môžem hrať (ťahák)

| Chcem...                        | Kde to zmením                                                       |
| ------------------------------- | ------------------------------------------------------------------- |
| inú výšku sirény                | `sirenHi` / `sirenLo` v `stereo_ambulance.json`                     |
| rýchlejšie „ný-ný" sirény       | menší `sirenStepMs`                                                 |
| dlhšie doznievanie vľavo        | väčší `recedeMs` (JSON) alebo bod `leftTail` v `ambulanceEnvelopes` |
| silnejší Doppler (väčší prepad) | vyšší `dopplerApproach`, nižší `dopplerRecede`                      |
| presné hlasitosti uší sanitky   | čísla v `ambulanceEnvelopes(amb)` v `player.js`                     |
| iné noty / rytmus skladby       | `notes` a `options.dur` v príslušnom songu                          |
| do ktorého ucha pattern znie    | `"pan"` pri patterne (`-1`/`0`/`+1`)                                |
| pridať novú skladbu             | nový `.json` do `songs/`, potom `npm run build`                     |

Po pridaní/zmene skladby spusti v priečinku `zxplayer`:

```bash
npm run build        # prepíše zoznam skladieb (songs/index.json)
python -m http.server 8080   # spustí lokálny server
```

a otvor `http://localhost:8080`. (Tvrdý reload **Cmd+Shift+R**, ak meníš `player.js`.)

---

## 10. Sprav si Drum & Bass so striedaním na uši

Drum & Bass = rýchle tempo (~170 BPM), **basa** + **bicie** + krátke **stáby** (lead).
Spravíme: basa a bicie v strede (do oboch uší), a **lead stáb skáče bar po bare ĽAVÉ↔PRAVÉ**.

**Tempo na ms:** jeden „krok" (šestnástinka) = `60000 / BPM / 4`. Pri 170 BPM ≈ **88 ms**
(zaokrúhlime na 90). Jeden takt = 16 krokov = `16 × 90 = 1440 ms`.

Ulož toto ako `songs/dnb_ears.json`, spusti `npm run build`, reload, a vyber v menu:

```json
{
  "schemaVersion": 1,
  "stereo": true,
  "id": "dnb_ears",
  "title": "DnB Ears (L/R stab)",
  "artist": "Fox",
  "description": "Drum & Bass: basa a bicie v strede, lead stáb skáče po bare ľavé↔pravé.",
  "channels": {
    "A": {
      "label": "SUB BASS",
      "patterns": {
        "bass": {
          "notes": "C2 r C2 r C2 r C2 r D#2 r C2 r F2 r C2 r",
          "options": { "dur": 90 },
          "pan": 0
        }
      },
      "arrangement": [{ "pattern": "bass", "repeat": 8 }]
    },
    "B": {
      "label": "DRUMS",
      "patterns": {
        "break": {
          "notes": "C5 r C5 C5 D5 r C5 r C5 r C5 C5 D5 r C5 r",
          "options": { "dur": 90, "noise": true, "noisePeriod": 16 },
          "pan": 0
        }
      },
      "arrangement": [{ "pattern": "break", "repeat": 8 }]
    },
    "C": {
      "label": "STAB L/R",
      "patterns": {
        "stabL": {
          "notes": "G4 r r r A#4 r r r G4 r D5 r r r r r",
          "options": { "dur": 90 },
          "pan": -1
        },
        "stabR": {
          "notes": "D5 r r r C5 r r r A#4 r G4 r r r r r",
          "options": { "dur": 90 },
          "pan": 1
        }
      },
      "arrangement": [
        { "pattern": "stabL" },
        { "pattern": "stabR" },
        { "pattern": "stabL" },
        { "pattern": "stabR" },
        { "pattern": "stabL" },
        { "pattern": "stabR" },
        { "pattern": "stabL" },
        { "pattern": "stabR" }
      ]
    }
  }
}
```

Čo počuješ: stála basa + bicie v strede, a **stáb každý takt preskočí do druhého ucha**.
Chceš rýchlejšie striedanie? Sprav `stabL`/`stabR` kratšie (napr. 8 krokov) a viac ich vystriedaj.
Chceš plynulý prelet namiesto skoku? Daj patternu `"sweep": { "from": -1, "to": 1 }` namiesto `pan`.

---

## 11. Čo z toho prejde do zx-kit a čo nie

Najprv si ujasni **vrstvy** (toto je jadro celej tvojej otázky):

```
┌───────────────────────────────────────────────┐
│  HRA / APLIKÁCIA  (zxplayer, neskôr Minefield) │
│  - vie o svojich súboroch a JSON               │
│  - rozhodne, čo a kedy hrá                      │
│  - VOLÁ zx-kit                                  │
└───────────────────────────────────────────────┘
                     │ posiela NOTY
                     ▼
┌───────────────────────────────────────────────┐
│  KNIŽNICA  zx-kit                               │
│  - rozumie NOTÁM (seq → tóny) a hrá ich (playAY)│
│  - NEvie nič o JSON, súboroch ani o hre         │
└───────────────────────────────────────────────┘
```

- **Do zx-kit patrí len jedna nová schopnosť: PAN** (do ktorého ucha kanál znie). To je malá,
  čistá, „natívna" vec — presne ako v štúdii: vložiť `StereoPannerNode` pred výstup a pridať
  `pan` parameter / `setStereoMode('mono'|'abc'|'acb')`. Default `0` = ako doteraz (nič sa nerozbije).
- **Do zx-kit NEPATRÍ:**
  - **Sanitka / Doppler** — to je špeciálny efekt nášho prehrávača (vlastný syntetizátor),
    nie „nota" pre AY. Zostáva v aplikácii.
  - **Čítanie JSON** — to je práca hry, nie knižnice (viď ďalšia časť).

Inak povedané: z toho, čo sme spravili, sa „presťahuje" do zx-kit **iba myšlienka panningu**
(ľavé/stred/pravé na kanál). Striedanie na uši v Drum & Bass-e potom v hre spravíš tak,
že kanálu nastavíš `pan`, alebo zavoláš `setStereoMode(...)`.

---

## 12. Ľahšie: natvrdo noty, alebo naučiť zx-kit čítať JSON?

Krátka odpoveď: **ani jedno presne tak, ako to znie — nepleť vrstvy.**

- **zx-kit NEUČ čítať JSON.** Knižnica by nemala vedieť o formáte súborov konkrétnej hry.
  Keby si to spravil, každá ďalšia hra by bola uväznená v tvojom formáte a knižnica by
  zbytočne napuchla. To je „zlá vrstva".
- **Noty do hry** sa dostanú jedným z dvoch spôsobov — a **rozhodne to hra, nie zx-kit:**
  1. **Natvrdo v kóde hry:** `playAY({ a: seq("C4 D4 ..."), ... })`. Najjednoduchšie pre pár
     krátkych zvukov (napr. Minefield: pár pípnutí a smerové cue).
  2. **Hra si číta vlastný JSON** (ako to robí náš zxplayer) a volá `seq`. Lepšie, keď máš
     veľa skladieb a chceš ich pridávať bez zásahu do kódu.
- **Do zx-kit pridáš len `pan`.** To je tá najmenšia a najsprávnejšia zmena.

**Odporúčanie pre Minefield:** smerové cue (smer míny v ľavom/pravom uchu) sú krátke zvuky —
pokojne **natvrdo v kóde hry** (`seq` + nový `pan`). Žiadny JSON tam netreba. Náš JSON svet
ostáva v prehrávači/D&B experimentoch.

---

## 13. Ako to po presune otestovať

Postupnosť (od najlacnejšieho po „uchom"):

1. **Smoke-test v zx-kit (najprv):**
   - pridáš `pan` do AY (a/alebo `setStereoMode`),
   - spustíš **existujúce testy zx-kitu** — _musia ostať zelené_ (nič sa nerozbilo),
   - pridáš malý test: pri `pan = 0` je výsledok ako predtým (mono),
     pri `pan = -1` ide signál doľava, pri `+1` doprava. **Smerovanie sa dá overiť hodnotou**
     (deterministicky), takže to vie skontrolovať aj stroj, nielen ucho.
2. **Manuálny počuteľný test (ty):** krátka ukážka — zahraj tón s `pan -1`, `0`, `+1`
   a uchom potvrď, že sedí ľavé/stred/pravé.
3. **Implementácia do Minefield:** smer míny → `pan`. Ľavá mína = `-1`, pravá = `+1`,
   priamo pred tebou = `0`. (Plus voliteľne hlasitosť podľa vzdialenosti.)
4. **Tvoj počuteľný test v Minefielde:** zahraj „poslepiačky" a over, či ti uši správne
   napovedia smer. Toto je ten finálny, kvôli ktorému to celé robíme.

---

## 14. Slovníček

- **Hz (Hertz)** — koľkokrát za sekundu sa niečo zachveje; vyššie = vyšší tón.
- **oktáva** — interval, kde sa frekvencia zdvojnásobí (C4 → C5 = 2×).
- **oscilátor** — generátor tónu (tvar vlny: square/sawtooth/sine/triangle).
- **gain** — hlasitosť (0 = ticho, 1 = plno).
- **pan** — poloha vľavo–vpravo (−1 / 0 / +1).
- **envelope (obálka)** — ako sa hlasitosť mení v čase (nábeh, držanie, dozvuk).
- **Doppler** — zmena vnímanej výšky, keď sa zdroj približuje (vyššie) / vzďaľuje (nižšie).
- **AY** — zvukový čip ZX Spectrum 128 (tri kanály tónov + šum).
- **beeper** — jednobitový pípák ZX Spectrum 48 (mono).
- **BPM** — údery za minútu = tempo.
- **uzol / node** — jedna „krabička" vo Web Audio linke.
- **CDN** — server na internete, odkiaľ si prehrávač ťahá knižnicu zx-kit.
- **smoke-test** — rýchle overenie „nehorí to, základ funguje" pred poriadnym testom.
