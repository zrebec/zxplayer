# Ako funguje stereo zvuk v ZX-KIT Player

> Polopatický sprievodca od úplného začiatočníka po stredne pokročilého.
> Je určený aj človeku, ktorý nemá hudobný sluch a nikdy nerobil zvuk v kóde.
> Čítaj pokojne po častiach: každý dôležitý pojem najprv vysvetlíme cez prirovnanie.

## Obsah

1. [Ako vôbec počítač vyrobí zvuk](#1-ako-vôbec-počítač-vyrobí-zvuk)
2. [Štyri „krabičky“, z ktorých skladáme zvuk](#2-štyri-krabičky-z-ktorých-skladáme-zvuk)
3. [Štyri zvukové cesty prehrávača](#3-štyri-zvukové-cesty-prehrávača)
4. [Kto číta JSON a kto vyrába zvuk](#4-kto-číta-json-a-kto-vyrába-zvuk)
5. [Rozbor bežnej JSON skladby](#5-rozbor-bežnej-json-skladby)
6. [Pan, stereo režim a sweep](#6-pan-stereo-režim-a-sweep)
7. [Handles, mixer, MUTE a SOLO](#7-handles-mixer-mute-a-solo)
8. [Hlasitosť AY, obálka a šum](#8-hlasitosť-ay-obálka-a-šum)
9. [Sanitka: jediný lokálny procedurálny efekt](#9-sanitka-jediný-lokálny-procedurálny-efekt)
10. [AY Soundcheck: 31-sekundová manuálna diagnostika](#10-ay-soundcheck-31-sekundová-manuálna-diagnostika)
11. [Monitor, časovanie a autoplay](#11-monitor-časovanie-a-autoplay)
12. [Kde sa s tým hrať a ako zmenu overiť](#12-kde-sa-s-tým-hrať-a-ako-zmenu-overiť)
13. [Slovníček](#13-slovníček)

---

## 1. Ako vôbec počítač vyrobí zvuk

Zvuk je **chvenie vzduchu**. Membrána reproduktora sa hýbe tam a späť a tlačí vzduch. Toto chvenie dorazí do
ucha. Rýchlejšie chvenie počujeme ako vyšší tón, pomalšie ako hlbší tón.

Počítač zvuk vyrobí tak, že mnohotisíckrát za sekundu určuje okamžitú polohu membrány. V prehliadači sa o to stará
**Web Audio API**. My nemusíme ručne vyrábať každú vzorku; skladáme zvukovú cestu z hotových uzlov:

```text
[ZDROJ TÓNU] → [HLASITOSŤ] → [ĽAVO / PRAVO] → [HLAVNÝ MIX] → [REPRODUKTOR]
```

Predstav si to ako potrubie. Každý uzol je jedna krabička a `.connect(...)` je kábel medzi krabičkami.

Pár frekvencií pre predstavu:

- `440 Hz` je komorné A;
- oktáva vyššie má dvojnásobnú frekvenciu, teda `880 Hz`;
- oktáva nižšie má polovičnú frekvenciu, teda `220 Hz`;
- pomlčka má frekvenciu `0` a znamená ticho.

## 2. Štyri „krabičky“, z ktorých skladáme zvuk

| Krabička            | Čo robí                                                       | Prirovnanie                                 |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `OscillatorNode`    | Vyrába periodický tón s určenou frekvenciou a tvarom vlny.    | Struna alebo píšťala.                       |
| `GainNode`          | Mení hlasitosť; `0` je ticho, `1` plná úroveň.                | Kohútik alebo fader na mixpulte.            |
| `StereoPannerNode`  | Posúva signál od `-1` vľavo cez `0` v strede po `+1` vpravo.  | Ovládač BALANCE.                            |
| `ChannelMergerNode` | Spojí osobitný ľavý a pravý signál do jedného stereo výstupu. | Dva samostatné káble, jeden pre každé ucho. |

Na konci je spoločný hlavný gain knižnice zx-kit a potom `AudioContext.destination`, čiže reproduktory alebo
slúchadlá.

### Pan nie je to isté ako dva nezávislé kanály

`StereoPannerNode` presúva **jeden** signál medzi ľavým a pravým uchom. Pri `pan = 0` ho počujú obe uši. Nedáva však
aplikácii dve úplne nezávislé obálky.

Sanitka potrebuje niečo iné: osobitný `GainNode` pre ľavé ucho a osobitný `GainNode` pre pravé ucho, ktoré sa menia
nezávisle. Preto používa `ChannelMergerNode`. Bežné AY skladby takúto špeciálnu cestu nepotrebujú.

## 3. Štyri zvukové cesty prehrávača

ZX-KIT Player pozná štyri runtime cesty. Prvé tri interpretuje **zx-kit**; štvrtá je zámerná lokálna výnimka.

| Zdroj                       | Kto zvuk interpretuje | Volanie              | Čo dostaneme späť          |
| --------------------------- | --------------------- | -------------------- | -------------------------- |
| JSON kanály A/B/C           | zx-kit                | `playAY(...)`        | `AYHandle`                 |
| Voliteľná JSON stopa BEEPER | zx-kit                | `playPattern(...)`   | `BeeperPatternHandle`      |
| PSG registrový dump         | zx-kit                | `playAYDump(...)`    | `AYDumpHandle`             |
| JSON efekt `ambulance`      | zxplayer              | `playAmbulance(...)` | malý lokálny handle efektu |

### JSON AY

Tri polia hotových nôt sa odovzdajú naraz:

```js
const ayHandle = playAY(
  {
    a: tracks.A,
    b: tracks.B,
    c: tracks.C,
    gains: { A: 1, B: 1, C: 1 },
    stereo: 'acb',
  },
  playbackClock.getStartDelayMs(),
);
```

zx-kit vytvorí tóny, AY hlasitosti, LFSR šum, hardvérové obálky aj authored pan. zxplayer už nemá vlastný AY,
noise ani envelope renderer.

### Beeper

Beeper je samostatný jednobitový hlas, nie štvrtý register AY čipu:

```js
const beeperHandle = playPattern(beeperNotes, playbackClock.getStartDelayMs());
beeperHandle.setGain(1, 0);
```

`playPattern()` rešpektuje pomlčky, naplánuje celý monofónny rad a vráti izolovaný handle. Zastavenie tejto stopy
nezastaví cudzie beeper efekty v inej časti aplikácie.

### PSG

PSG súbor už obsahuje zápisy registrov R0–R13 po snímkach. Prehráva ho jedno upstream AudioWorklet jadro:

```js
const psgHandle = await playAYDump(dump, {
  ...AY_MACHINE.melodik,
  stereo: 'acb',
  channelGains: { A: 1, B: 1, C: 1 },
});
```

Gain A/B/C sa aplikuje až na príspevok kanála po emulácii registrov. zxplayer nemaskuje R8–R10 a nespúšťa tri
paralelné čipy.

## 4. Kto číta JSON a kto vyrába zvuk

Najdôležitejšie rozdelenie zodpovednosti vyzerá takto:

```text
┌────────────────────────────────────────────────────────────┐
│ zxplayer                                                   │
│                                                            │
│  načíta a overí JSON                                       │
│  rozbalí patterns + arrangement                            │
│  premení názvy nôt cez seq() / noteToFreq()                │
│  vytvorí tracks pre audio a timelines pre monitor          │
│  rozhoduje o MUTE, SOLO, hlasitosti a dostupnosti kanálov  │
└───────────────────────────┬────────────────────────────────┘
                            │ hotové noty alebo AYDump
                            ▼
┌────────────────────────────────────────────────────────────┐
│ zx-kit                                                     │
│                                                            │
│  playAY()       → AY tóny, noise, envelope, pan            │
│  playPattern()  → samostatná Beeper stopa                  │
│  playAYDump()   → sample-accurate PSG AudioWorklet         │
└───────────────────────────┬────────────────────────────────┘
                            │ controllable handles
                            ▼
┌────────────────────────────────────────────────────────────┐
│ zxplayer playback adapter                                  │
│                                                            │
│  smeruje A/B/C/BEEPER gain a stereo na správny handle      │
└────────────────────────────────────────────────────────────┘
```

> zx-kit nečíta formát súborov zxplayera. Knižnica dostane až hotové notové polia alebo parsovaný AYDump.

Toto rozdelenie je užitočné aj v inej hre. Krátky zvuk môže byť natvrdo v kóde, väčšia hudobná knižnica môže mať
vlastný JSON, ale obe aplikácie môžu použiť rovnaké primitíva zx-kit.

## 5. Rozbor bežnej JSON skladby

Bežná skladba má tri AY kanály a môže mať samostatný Beeper. Zjednodušený príklad:

```json
{
  "schemaVersion": 1,
  "id": "my_song",
  "title": "My Song",
  "ay": {
    "pan": { "A": -0.4, "B": 0, "C": 0.4 }
  },
  "channels": {
    "A": {
      "label": "BASS",
      "patterns": {
        "bass": {
          "notes": "C2 r C2 r",
          "options": { "dur": 180, "vol": 11 }
        }
      },
      "arrangement": [{ "pattern": "bass", "repeat": 4 }]
    },
    "B": {
      "label": "LEAD",
      "patterns": {
        "lead": {
          "events": [
            { "note": "E4", "dur": 180, "vol": 12 },
            { "note": "G4", "dur": 180, "envShape": 13, "envCycleDurMs": 25 }
          ]
        }
      },
      "arrangement": [{ "pattern": "lead", "repeat": 4 }]
    },
    "C": {
      "label": "TEXTURE",
      "patterns": {
        "noise": {
          "notes": "r r r r",
          "options": { "dur": 180, "noise": true, "noisePeriod": 12, "vol": 8 }
        }
      },
      "arrangement": [{ "pattern": "noise", "repeat": 4 }]
    }
  },
  "beeper": {
    "label": "ACCENTS",
    "pan": 0,
    "patterns": {
      "hit": {
        "events": [
          { "freq": 1200, "dur": 30 },
          { "note": "r", "dur": 690 }
        ]
      }
    },
    "arrangement": [{ "pattern": "hit", "repeat": 4 }]
  }
}
```

### Slovník JSON skladby

- **kanál** je jeden z hlasov `A`, `B`, `C`;
- **pattern** je pomenovaný krátky úsek;
- **notes** je kompaktný text nôt, napríklad `C4 E4 G4 r`;
- **events** je podrobnejší zápis, kde môže mať každý krok vlastné hodnoty;
- **arrangement** určuje poradie patternov;
- **repeat** zopakuje pattern bez kopírovania dát;
- `r` je pomlčka a posúva čas rovnako ako nota;
- `dur` je dĺžka v milisekundách.

`seq()` prevedie názov ako `E4` na frekvenciu. `noteToFreq()` robí rovnaký prevod pre jednotlivý event. zxplayer
potom patterny rozbalí do jedného súvislého poľa nôt pre každý kanál.

## 6. Pan, stereo režim a sweep

### Tri stereo presety

Prehrávač ponúka:

- `MONO`: A, B aj C sú v strede;
- `ACB`: A vľavo, B vpravo, C v strede;
- `ABC`: A vľavo, B v strede, C vpravo.

Zvolený režim sa pri štarte pošle do `playAY()` alebo `playAYDump()`. Beeper má vlastné `beeper.pan` a nie je
súčasťou AY presetu.

### Authored pan

Skladba môže určiť základné umiestnenie celého AY kanála:

```json
"ay": {
  "pan": { "A": -0.45, "B": 0, "C": 0.45 }
}
```

Pattern môže polohu dočasne určiť presnejšie:

```json
{
  "notes": "C5 r C5 r",
  "options": { "dur": 500 },
  "pan": -1
}
```

`pan = -1` znamená úplne vľavo, `0` stred a `1` úplne vpravo.

### Sweep

Plynulý prelet sa zapisuje na patterne:

```json
{
  "events": [{ "note": "A4", "dur": 2000, "vol": 11 }],
  "sweep": { "from": -1, "to": 1 }
}
```

zxplayer preloží sweep do upstream `AYNote.pan` a `AYNote.panTo`. Ak má pattern viac nôt, rozdelí dráhu medzi
všetky kroky tak, aby sa pan plynulo posúval cez celý pattern.

### Čo spraví klik na stereo počas prehrávania

Ak počas aktívnej JSON skladby klikneš na `MONO`, `ACB` alebo `ABC`, prehrávač zavolá
`AYHandle.setStereoMode()`. Toto je **live override**:

- nový preset okamžite prevezme A/B/C;
- budúca authored pan automatizácia tejto rozohranej skladby sa zruší;
- monitor od tej chvíle ignoruje pôvodné `pan` a `sweep` a ukazuje live preset;
- Beeper si ponechá vlastný pan;
- nový štart skladby znova načíta jej authored pan a sweep.

Pri PSG volá adaptér `AYDumpHandle.setStereo()`. Sanitka má vlastnú L/R trajektóriu, takže AY stereo preset ju
neprepisuje.

## 7. Handles, mixer, MUTE a SOLO

Handle si môžeš predstaviť ako diaľkový ovládač k práve spustenému zvuku. Neobsahuje noty; poskytuje bezpečné live
ovládanie už vytvorenej audio cesty.

```text
AYHandle                 setChannelGain(A/B/C), setStereoMode(), stop()
AYDumpHandle             setChannelGain(A/B/C), setStereo(), stop()
BeeperPatternHandle      setGain(), stop()
lokálny handle efektu    setChannelGain(A/B/C), stop()
```

Rozdielne názvy metód schováva `scripts/playback-adapter.js`. Zvyšok UI môže povedať iba:

```js
activeHandle.setChannelGain(channel, targetGain, 15);
```

Adaptér rozhodne, kam príkaz patrí:

- A/B/C pošle do aktívneho AY, PSG alebo handle efektu;
- BEEPER pošle do `BeeperPatternHandle.setGain()`;
- stereo pošle ako `setStereoMode()` pre AY alebo `setStereo()` pre PSG;
- `stop()` zastaví všetky handles, ktoré patria jednej skladbe.

### Mixer je politika zxplayera

zx-kit poskytuje ovládateľné gainy, ale nevie, čo má znamenať tlačidlo SOLO v tomto prehrávači. O tom rozhoduje
`channel-mixer.js`:

- **MUTE** nastaví výstup daného kanála na nulu;
- **SOLO** nechá počuteľný iba vybraný dostupný kanál;
- fader `0–100 %` násobí výslednú hlasitosť;
- RESET MIX vráti uložené fadery vybranej skladby na `100 %`;
- hlasitosti sa ukladajú po skladbách do localStorage.

Mixer nemení authored `vol`, AY registre ani envelope shape. Je to samostatná výstupná vrstva za hudobnou
interpretáciou.

Počiatočné gainy A/B/C sa odovzdajú už v options `playAY()` alebo `playAYDump()`, aby mute neprepustil ani prvý
audio frame. Beeper dostane po vytvorení handle okamžité `setGain(..., 0)` ešte pred 120 ms štartovacím oneskorením.

## 8. Hlasitosť AY, obálka a šum

AY nota môže mať tieto dôležité polia:

| Pole            | Význam                                                 |
| --------------- | ------------------------------------------------------ |
| `freq`          | frekvencia v Hz; `0` je pomlčka                        |
| `dur`           | dĺžka v milisekundách                                  |
| `vol`           | AY hlasitosť `0–15` na hardvérovej logaritmickej škále |
| `noise`         | primieša LFSR šum                                      |
| `noisePeriod`   | farba šumu `1–31`; vyššia hodnota znie temnejšie       |
| `envShape`      | tvar hardvérovej obálky R13, hodnota `0–15`            |
| `envCycleDurMs` | čas jedného nábehu alebo poklesu obálky                |

### Dve rôzne hlasitosti

`vol: 12` je súčasť skladby a určuje charakter konkrétnej noty. Fader kanála je používateľský mix. Ak je authored
nota polovične hlasná a fader na `50 %`, výsledok je ich kombinácia. Fader neprepisuje JSON.

### Shape 13

Shape 13 znamená krátky útok nahor a následné držanie vysokej úrovne. V AY Soundchecku používa kanál B:

```json
{ "note": "A4", "dur": 3000, "envShape": 13, "envCycleDurMs": 25 }
```

Úroveň narastie počas 25 ms a potom sa drží do konca trojsekundovej noty. Interpretáciu všetkých 16 obálok robí
zx-kit. `AY_ENVELOPE_SHAPES` sú iba zobrazovacie značky pre monitor, nie návod na dekódovanie bitov.

### Noise-only event

Pomlčka môže niesť šum:

```json
{ "note": "r", "dur": 250, "vol": 10, "noise": true, "noisePeriod": 6 }
```

Frekvencia tónu je nulová, ale LFSR šum hrá. Takto sa robia krátke hi-haty alebo perkusné textúry na AY kanáli.

## 9. Sanitka: jediný lokálny procedurálny efekt

`songs/stereo_ambulance.json` nie je AY skladba. Metadata ju preto správne označujú ako
`procedural Web Audio effect`.

```json
{
  "effect": "ambulance",
  "ambulance": {
    "approachMs": 4000,
    "passMs": 2800,
    "recedeMs": 5200,
    "sirenHi": 760,
    "sirenLo": 580,
    "sirenStepMs": 560,
    "dopplerApproach": 1.06,
    "dopplerRecede": 0.9
  }
}
```

`playAmbulance()` vytvorí jeden súvislý **sawtooth oscilátor**. Nie je to emulácia AY čipu. Frekvencia strieda dva
tóny sirény a počas preletu klesá z približovacieho násobku na vzďaľovací násobok.

Ľavé a pravé ucho majú samostatné obálky vo funkcii `ambulanceEnvelopes()`:

```text
PRAVÉ: skoro ticho → silnie pri príchode → po prelete rýchlo zhasne
ĽAVÉ:  ticho pri príchode → narastie počas preletu → dlho doznieva
```

Tri UI kanály A/B/C pri Sanitke nepredstavujú tri AY oscilátory. Označujú fázy `PRIBLIŽOVANIE`, `PRELET` a
`VZĎAĽOVANIE`. Lokálny handle efektu ich gainy stále pripája k rovnakému mixeru MUTE/SOLO/volume.

Sanitka zostala lokálna preto, že ide o špecifický plynulý Dopplerov efekt s nezávislými obálkami pre obe uši. Nie
je to všeobecná interpretácia hudobných dát, ktorá by patrila do zx-kit.

## 10. AY Soundcheck: 31-sekundová manuálna diagnostika

`songs/ay_soundcheck.json` je verejný signálový test celej aktuálnej cesty. Všetky štyri stopy majú presne
`31 000 ms`, takže monitor aj audio zostanú zarovnané.

| Čas     | Čo má hrať                                                               |
| ------- | ------------------------------------------------------------------------ |
| 0–2 s   | A: C3 úplne vľavo                                                        |
| 2–4 s   | B: E4 v strede                                                           |
| 4–6 s   | C: G5 úplne vpravo                                                       |
| 6–8 s   | súvislý Beeper A5                                                        |
| 8–11 s  | trojhlas C3 / E4 / G4                                                    |
| 11–14 s | B: A4, shape 13, 25 ms attack a následné držanie                         |
| 14–18 s | oddelené ľavé a pravé pulzy                                              |
| 18–20 s | konštantné A4 so sweepom zľava doprava                                   |
| 20–22 s | rovnaké A4 so sweepom sprava doľava                                      |
| 22–30 s | DnB mini-mix: A basa, B tón/šum bicie, C striedavé stáby, Beeper hi-haty |
| 30–31 s | kontrolné ticho na A, B, C aj BEEPER                                     |

### Odporúčaný manuálny postup

1. Použi slúchadlá a nastav rozumnú systémovú hlasitosť.
2. Vyber AY Soundcheck a stlač RESET MIX.
3. Spusť PLAY a sleduj čas aj štyri kanálové karty.
4. Pri izolovaných úsekoch skús MUTE a SOLO príslušného kanála.
5. Pri akorde skús samostatne A, B a C.
6. Pri Beeper úseku over, že MUTE/SOLO/fader BEEPER neovplyvní AY.
7. Sweep najprv vypočuj bez zásahu.
8. Pri ďalšom prehratí klikni počas sweepu na MONO, ACB alebo ABC. Live override musí okamžite prevziať stereo a
   monitor má ukazovať nový preset, nie pokračovanie authored sweepu.
9. Po zastavení a novom PLAY sa authored pan automatizácia obnoví.
10. Poslednú sekundu musí byť ticho.

Automatické testy overujú dáta, presné okná a trvanie. Samotný výsledný zvuk musí potvrdiť človek posluchom;
headless test zvuk nepočuje.

## 11. Monitor, časovanie a autoplay

Monitor nie je mikrofón ani spektrálny analyzátor. Pre JSON skladbu číta rovnakú lokálnu timeline, z ktorej vznikli
notové polia pre zx-kit. Preto vie deterministicky ukázať:

- názov patternu a číslo opakovania;
- aktuálny krok a token;
- TONE, NOISE, TONE + NOISE, BEEP alebo REST;
- `VOL`, `ENV` a `NP`;
- authored alebo live stereo polohu.

PSG monitor namiesto timeline priebežne aplikuje registrové zápisy do vlastnej zobrazovacej kópie R0–R13. Táto
kópia iba kreslí stav; audio stále vyrába jediné upstream `playAYDump()` jadro.

### Spoločný štart

Prehrávač najskôr určí jeden absolútny cieľ na audio hodinách, 120 ms v budúcnosti. AY aj Beeper dostanú tesne pred
svojím upstream volaním zostávajúce oneskorenie k tomu istému cieľu; monitor a koncový timer sa odvodia z rovnakých
hodín. Monitor aj kontrola konca potom priebežne čítajú `AudioContext.currentTime`: ak prehliadač audio pozastaví,
neutečú pred zvuk. Krátky predstih dá prehliadaču priestor pripraviť naplánované uzly a obmedzuje drift medzi stopami.

### Autoplay pravidlo

`AudioContext` sa nesmie vytvoriť pri importe ani pri načítaní stránky. `initAudio()` aj začiatok `resume()` sa
volajú synchronne až v click handleri PLAY. Prehrávač potom dočká resume Promise a plánuje zvuk iba v stave
`running`, takže prehliadač vidí skutočné používateľské gesto a monitor sa nerozbehne bez audia.

PSG príprava AudioWorkletu je asynchrónna. Ak používateľ medzitým stlačí STOP alebo vyberie inú skladbu, zxplayer po
`await` porovná `playbackId`; zrušený queued request sa vôbec nespustí. Už rozbehnutá príprava zostáva stlmená a
neskorý handle sa zastaví bez pripojenia k UI. Prvé vytvorenie workletu je serializované, aby sa dve požiadavky
nepokúsili zaregistrovať ten istý processor naraz.

## 12. Kde sa s tým hrať a ako zmenu overiť

| Chcem zmeniť…                 | Kde                                                  |
| ----------------------------- | ---------------------------------------------------- |
| noty alebo rytmus skladby     | `notes`, `events`, `dur` v príslušnom `songs/*.json` |
| authored hlasitosť noty       | `vol`                                                |
| šumovú textúru                | `noise` a `noisePeriod`                              |
| AY obálku                     | `envShape` a `envCycleDurMs`                         |
| základný pan kanálov          | `ay.pan`                                             |
| polohu jedného patternu       | `pan` na patterne                                    |
| plynulú stereo dráhu patternu | `sweep: { from, to }`                                |
| pan celej Beeper stopy        | `beeper.pan`                                         |
| výšku a rytmus sirény         | `sirenHi`, `sirenLo`, `sirenStepMs`                  |
| dĺžku fáz Sanitky             | `approachMs`, `passMs`, `recedeMs`                   |
| presné L/R obálky Sanitky     | `ambulanceEnvelopes()` v `scripts/player.js`         |
| mixer politiku                | `scripts/channel-mixer.js`                           |
| smerovanie upstream handles   | `scripts/playback-adapter.js`                        |

Po zmene skladby alebo prehrávača spusti:

```bash
npm run format
npm test
npm run build
npm run dev
```

Potom otvor lokálnu adresu z Vite, stlač PLAY a urob manuálny posluch. Pri audio zmene sa nespoliehaj iba na to, že
build prešiel: build overí syntax a dáta, nie to, čo človek skutočne počuje.

Pri novej JSON skladbe drž všetky kanály časovo zarovnané explicitnými pomlčkami. Prehrávač síce použije najdlhší
kanál ako celkové trvanie, ale rovnaké dĺžky zjednodušia monitor, diagnostiku aj budúce úpravy.

## 13. Slovníček

- **Hz (hertz)** — počet kmitov za sekundu; vyššie číslo znamená vyšší tón.
- **oktáva** — interval, pri ktorom sa frekvencia zdvojnásobí.
- **oscilátor** — generátor periodického tónu.
- **sawtooth** — pílová vlna s výrazným ostrým spektrom; používa ju Sanitka.
- **gain** — násobiteľ hlasitosti, typicky od `0` do `1`.
- **pan** — poloha jedného signálu v stereo priestore od `-1` po `1`.
- **sweep** — plynulá zmena panu z jednej polohy do druhej.
- **envelope / obálka** — priebeh hlasitosti v čase.
- **Dopplerov jav** — zmena vnímanej výšky pri približovaní a vzďaľovaní zdroja.
- **AY-3-8910 / AY-3-8912** — trojkanálový zvukový čip so spoločným šumom a hardvérovou obálkou.
- **Beeper** — nezávislý jednobitový hlas ZX Spectrum 48K.
- **PSG dump** — časový prúd zápisov do registrov zvukového čipu.
- **AudioWorklet** — audio kód bežiaci na osobitnom real-time vlákne prehliadača.
- **handle** — ovládač jedného konkrétneho prehrávania: gain, stereo, stop.
- **playback adapter** — tenká vrstva, ktorá prekladá spoločné UI príkazy na metódy rôznych handles.
- **authored pan** — stereo poloha zapísaná autorom v dátach skladby.
- **live override** — používateľský stereo príkaz, ktorý počas prehrávania prevezme riadenie od authored automatizácie.
- **LFSR noise** — deterministický pseudošum typický pre AY bicie a textúry.
- **CDN** — server, z ktorého browser wrapper načíta presnú verziu zx-kit.
- **smoke test** — krátke overenie, že základná cesta funguje.
