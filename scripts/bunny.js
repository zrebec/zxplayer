import {
  setupCanvas,
  createBitmapFromRows,
  drawBitmap,
  C,
} from 'https://cdn.jsdelivr.net/npm/zx-kit@0.35.0/dist/index.js';

// 16×24 "Big Ears Bunny" — chaosBunny DNA: blue body, white belly, pink ears, black eyes.
// '.' = transparent.  B = blue body  W = white belly  P = pink inner ear  K = black eye.
const BASE = [
  '....BBB..BBB....',
  '....BPB..BPB....',
  '....BPB..BPB....',
  '....BPB..BPB....',
  '....BPB..BPB....',
  '....BBB..BBB....',
  '...BBBBBBBBBB...',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '..BBKBBBBBBKBB..',
  '..BBBWWWWWWBBB..',
  '..BBWWWPPWWWBB..',
  '...BBWWWWWWBB...',
  '...BBBWWWWBBB...',
  '...BBWWWWWWBB...',
  '..BBWWWWWWWWBB..',
  '..BWWWWWWWWWWB..',
  '..BWWWWWWWWWWB..',
  '..BWWWWWWWWWWB..',
  '..BBWWWWWWWWBB..',
  '...BBWWWWWWBB...',
  '...BBB....BBB...',
  '..BBBB....BBBB..',
  '................',
];

// A frame = BASE with a few rows overridden.
const withRows = (overrides) => BASE.map((row, i) => overrides[i] ?? row);

const IDLE_OPEN = BASE;
const IDLE_BLINK = withRows({ 9: '..BBBBBBBBBBBB..' }); // eyes closed
const WALK_L = withRows({ 21: '..BBB.....BBB...', 22: '.BBBB....BBB....' }); // left foot forward
const WALK_M = BASE;
const WALK_R = withRows({ 21: '...BBB.....BBB..', 22: '....BBB....BBBB.' }); // right foot forward

// Full colour = one single-ink bitmap per palette symbol, overlaid (pixels never overlap).
const PALETTE = [
  ['B', C.B_BLUE],
  ['W', C.B_WHITE],
  ['P', C.B_MAGENTA],
  ['K', C.BLACK],
];
const maskFor = (rows, sym) => rows.map((row) => Array.from(row, (ch) => (ch === sym ? 'X' : '.')).join(''));
const buildLayers = (rows) => PALETTE.map(([sym, ink]) => [createBitmapFromRows(maskFor(rows, sym)), ink]);

const idle = [buildLayers(IDLE_OPEN), buildLayers(IDLE_BLINK)];
const walk = [buildLayers(WALK_L), buildLayers(WALK_M), buildLayers(WALK_R)];

const ctx = setupCanvas(document.getElementById('screen'), 3, 256, 192); // 768×576 CSS px
const drawLayers = (layers, x, y) => {
  for (const [bmp, ink] of layers) drawBitmap(ctx, bmp, x, y, ink);
};

const start = performance.now();
function frame(now) {
  const t = now - start;
  ctx.fillStyle = C.BLACK;
  ctx.fillRect(0, 0, 256, 192);

  // Idle bunny — centred near the top; a quick blink every ~2.6 s.
  drawLayers(idle[t % 2600 > 2480 ? 1 : 0], 120, 18);

  // Walking bunny — crosses the screen left→right, 3-beat legs + a small bounce.
  const wx = Math.round(-20 + ((t % 6000) / 6000) * (256 + 20));
  const step = Math.floor(t / 160) % 3; // 0=L 1=M 2=R
  drawLayers(walk[step], wx, 124 + (step === 1 ? 0 : -2));

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
