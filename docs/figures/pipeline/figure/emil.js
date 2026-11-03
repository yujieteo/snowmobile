// Emil Kowalski style for the upstream schematic-figure and patent-drawing skills.
// Values copied from the CSS that https://emilkowal.ski serves (2026-11-03) and from Radix Colors 3.0.0.
// Copy this file to figure/emil.js and the fonts/ folder to figure/fonts/ in the figure project.
// Use in figure/figure.js:
//   import * as E from './emil.js';
//   export default function draw(F, L) { E.useEmil(F, L, 'web'); ...; E.emilTheme(F); }

// Inter, loaded before the figure draws, so that the engine measures text in the right font.
const inter = new FontFace('Inter', `url(${new URL('./fonts/InterVariable.woff2', import.meta.url)})`, { weight: '100 900' });
document.fonts.add(inter);
await inter.load();
// The site sets these features on body: "cv01","ss03" and "opsz" auto.
const FEATURES = '"cv01", "ss03"';

// [light, dark] for each token. The CSS variable is --color-<name>, the same name the site uses for its grays.
export const TOKENS = {
  'gray-100': ['#fdfdfc', '#111110'], 'gray-200': ['#f9f9f8', '#191918'], 'gray-300': ['#f1f0ef', '#222221'],
  'gray-400': ['#e9e9e7', '#2a2a28'], 'gray-500': ['#e2e1de', '#31312e'], 'gray-600': ['#dad9d6', '#3b3a37'],
  'gray-700': ['#cfceca', '#494844'], 'gray-800': ['#bcbbb5', '#62605b'], 'gray-900': ['#8d8d86', '#6f6d66'],
  'gray-1000': ['#82827c', '#7c7b74'], 'gray-1100': ['#63635e', '#b5b3ad'], 'gray-1200': ['#21201c', '#eeeeec'],
  // Radix Colors 3.0.0. Step 3: area tint. Step 7: outline. Step 9: solid mark. Step 11: line or label on the background.
  'blue-3': ['#e6f4fe', '#0d2847'], 'blue-7': ['#8ec8f6', '#205d9e'], 'blue-9': ['#0090ff', '#0090ff'], 'blue-11': ['#0d74ce', '#70b8ff'],
  'sky-3': ['#e1f6fd', '#112840'], 'sky-7': ['#8dcae3', '#1f6692'], 'sky-9': ['#7ce2fe', '#7ce2fe'], 'sky-11': ['#00749e', '#75c7f0'],
  'grass-3': ['#e9f6e9', '#1b2a1e'], 'grass-7': ['#94ce9a', '#366740'], 'grass-9': ['#46a758', '#46a758'], 'grass-11': ['#2a7e3b', '#71d083'],
  'amber-3': ['#fff7c2', '#302008'], 'amber-7': ['#e9c162', '#714f19'], 'amber-9': ['#ffc53d', '#ffc53d'], 'amber-11': ['#ab6400', '#ffca16'],
  'orange-3': ['#ffefd6', '#331e0b'], 'orange-7': ['#f5ae73', '#7e451d'], 'orange-9': ['#f76b15', '#f76b15'], 'orange-11': ['#cc4e00', '#ffa057'],
  'tomato-3': ['#feebe7', '#391714'], 'tomato-7': ['#f5a898', '#853a2d'], 'tomato-9': ['#e54d2e', '#e54d2e'], 'tomato-11': ['#d13415', '#ff977d'],
  'violet-3': ['#f4f0fe', '#291f43'], 'violet-7': ['#c2b5f5', '#56468b'], 'violet-9': ['#6e56cf', '#6e56cf'], 'violet-11': ['#6550b9', '#baa7ff'],
};
const light = (n) => TOKENS[n][0];
const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
export const gray = Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].map((k) => [k, light(`gray-${k}`)]));
export const hue = Object.fromEntries(['blue', 'sky', 'grass', 'amber', 'orange', 'tomato', 'violet'].map((h) => [h, { 3: light(`${h}-3`), 7: light(`${h}-7`), 9: light(`${h}-9`), 11: light(`${h}-11`) }]));
// Text on a step 9 solid mark. Step 9 does not change in dark mode, so this text does not change either.
// rgb() and not hex: emilTheme themes only hex colours, so these stay fixed.
const WHITE = 'rgb(255, 255, 255)', DARK = `rgb(${rgb(light('gray-1200')).join(', ')})`;
export const onSolid = { blue: WHITE, grass: WHITE, orange: WHITE, tomato: WHITE, violet: WHITE, sky: DARK, amber: DARK };

// Site sizes in CSS px. Body 14 px, secondary 12 px (text-xs), headings 16 px at weight 550-600, borders 1 px,
// demo strokes 2 px, cards 12 px corners with a 1 px ring rgba(0,0,0,.08) (on gray-100 that is gray-400), chips 6 px.
export const PX = { label: 14, small: 12, title: 16, hair: 0.5, thin: 1, normal: 1.5, bold: 2, card: 12, chip: 6, pad: 16, gap: 24 };
// Font weights: names 500, running text 400, headings 600.
export const weight = { name: 500, text: 400, title: 600 };

// pt per site px for each venue, so the 14 px label lands on the venue's label size:
// web and journal 7 pt (Nature 5-7 pt), slide 18 pt (16-22 pt), poster 28 pt (24-36 pt).
const SCALE = { web: 0.5, journal: 0.5, slide: 18 / 14, poster: 2, 'patent-colour': 1 };
const LINE_MIN = { web: 0.25, journal: 0.25, slide: 0.8, poster: 1.5, 'patent-colour': 0.35 };

// useEmil(F, L, venue): call first in draw(). venue: web | journal | slide | poster | patent | patent-colour.
// It returns {s, r, line, text}: the scale, the corner radii in pt, and the venue's line and text sizes in pt.
export function useEmil(F, L, venue) {
  const S = L.STYLE;
  S.font.family = 'Inter, sans-serif';
  S.font.math = 'Inter, sans-serif';
  F.svg.style.fontFeatureSettings = FEATURES;
  if (venue === 'patent') {   // black and white: the upstream patent profile
    // Inter's "/" is taller than the Arial cap height that upstream uses to place the sheet number: keep it in the sight
    // The engine draws the sheet number before draw() runs, so it still has the Arial family: set Inter first, then measure.
    const sh = F.svg.querySelector('text[data-role=sheet]');
    sh?.setAttribute('font-family', S.font.family);
    const b = sh?.getBBox();
    if (b && b.y < F.sight.y) sh.setAttribute('y', +sh.getAttribute('y') + F.sight.y - b.y + 0.5);
    return { s: 1, r: { card: 0, chip: 0 }, line: S.line, text: S.text };
  }
  const s = SCALE[venue];
  if (s === undefined) throw new Error(`useEmil: unknown venue "${venue}"`);
  const c = S.color;
  Object.assign(c, {
    text: gray[1200], ink: gray[1200], mid: gray[900], light: gray[800], faint: gray[400], paper: gray[100],
    blue: hue.blue[9], sky: hue.sky[9], green: hue.grass[9], yellow: hue.amber[9], orange: hue.orange[9], vermillion: hue.tomato[9], purple: hue.violet[9],
    beam: hue.tomato[9], beamIR: hue.tomato[11], beamGreen: hue.grass[9], beamBlue: hue.blue[9], glass: hue.sky[3],
    metal: gray[700], silicon: gray[900], substrate: gray[500], gold: hue.amber[9],
    tintBlue: hue.blue[3], tintOrange: hue.orange[3], tintGreen: hue.grass[3], tintGrey: gray[300],
  });
  const min = LINE_MIN[venue], ln = (px) => Math.max(min, px * s);
  if (venue === 'patent-colour') {
    // the patent sizes (37 CFR 1.84: characters 0.32 cm, dense lines) with the Emil colours
    Object.assign(S.text, { panel: L.PATENT.text.fig, title: L.PATENT.text.legend, label: L.PATENT.text.numeral, small: L.PATENT.text.numeral, tick: L.PATENT.text.numeral, min: L.PATENT.text.numeral, max: L.PATENT.text.fig });
    Object.assign(S.line, L.PATENT.line);
    Object.assign(S.arrow, L.PATENT.arrow);
    sight(F, L);
  } else {
    Object.assign(S.text, { panel: PX.title * s, title: PX.title * s, label: PX.label * s, small: PX.small * s, tick: PX.small * s, min: PX.small * s, max: PX.title * s });
    Object.assign(S.line, { hair: ln(PX.hair), thin: ln(PX.thin), normal: ln(PX.normal), bold: ln(PX.bold), min });
  }
  F.svg.querySelector('[data-role=background]')?.setAttribute('fill', gray[100]);
  return { s, r: { card: PX.card * s, chip: PX.chip * s }, line: S.line, text: S.text };
}

// The colour patent sheet is a 'slide' figure at the patent sheet size (the slide gate checks the 14 pt text).
// sight() gives it the F.sight and F.drawing of a patent sheet, so the same drawing code serves both versions.
function sight(F, L) {
  const m = L.PATENT.margin;
  F.sightMM = { x: m.left, y: m.top, w: F.widthMM - m.left - m.right, h: F.heightMM - m.top - m.bottom };
  F.sight = { x: L.mm(F.sightMM.x), y: L.mm(F.sightMM.y), w: L.mm(F.sightMM.w), h: L.mm(F.sightMM.h) };
  F.drawing = { node: L.el(F.root, 'g', { transform: `translate(${F.sight.x.toFixed(3)} ${F.sight.y.toFixed(3)})`, 'data-part': 'sight' }) };
}

// patentFigure(base, colour): the figure export for one patent sheet. colour false: the filing version (upstream gate).
export function patentFigure(base, colour) {
  if (!colour) return { ...base, format: 'patent' };
  const [w, h] = { letter: [215.9, 279.4], a4: [210, 297] }[base.sheet ?? 'letter'];
  const { sheet, sheetId, numerals, ...rest } = base;
  return { ...rest, format: 'slide', width: w, height: h, name: `${base.name ?? 'fig'}-colour` };
}

// card(): the site's card as a style object for L.rect or L.box: white is gray-100, ring gray-400, 12 px corners.
export const card = (r) => ({ fill: gray[100], stroke: gray[400], r });

// ---- web output ------------------------------------------------------------------------------------
const hex = (c) => {
  const s = String(c).trim().toLowerCase();
  if (s === 'white') return '#ffffff'; if (s === 'black') return '#000000';
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((h) => h + h).join('');
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
};
const BY_HEX = new Map(Object.entries(TOKENS).map(([n, [l]]) => [l, n]));
// nearest token for a colour that is not a token (library shades, white, black): the figure keeps to the palette
function token(h) {
  if (BY_HEX.has(h)) return BY_HEX.get(h);
  const a = rgb(h);
  let best, d0 = Infinity;
  for (const [n, [l]] of Object.entries(TOKENS)) { const d = rgb(l).reduce((t, v, i) => t + (v - a[i]) ** 2, 0); if (d < d0) { d0 = d; best = n; } }
  return best;
}

// emilTheme(F, {animate}): call last in draw() for a web figure. Every colour becomes var(--color-<token>, light),
// so an inline SVG takes the page's tokens. A standalone SVG (svg:root) switches with prefers-color-scheme,
// and an inline SVG under a .dark element switches with the page. animate: true adds the entrance below.
export function emilTheme(F, { animate = false } = {}) {
  const used = new Set();
  for (const e of [F.svg, ...F.svg.querySelectorAll('*')]) {
    for (const a of ['fill', 'stroke', 'stop-color', 'flood-color']) {
      const h = hex(e.getAttribute(a) ?? '');
      if (!h) continue;
      const n = token(h); used.add(n);
      e.style.setProperty(a, `var(--color-${n}, ${light(n)})`);
    }
  }
  const dark = [...used].sort().map((n) => `--color-${n}: ${TOKENS[n][1]};`).join(' ');
  let css = `@media (prefers-color-scheme: dark) { svg:root { ${dark} } }\n.dark svg { ${dark} }\n`;
  if (animate) {
    // emil-design-eng: ease-out cubic-bezier(0.23, 1, 0.32, 1), never from scale(0), opacity with a small move,
    // a short stagger. Panels enter in reading order. No motion under prefers-reduced-motion.
    // Motion that explains a process (for example a beam that moves along its path) can be longer: emil-design-eng permits it.
    css += `@media screen and (prefers-reduced-motion: no-preference) {
  [data-panel] { animation: emil-in 300ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  @keyframes emil-in { from { opacity: 0; translate: 0 4px; } }
}
#host > svg [data-panel] { animation: none; }\n`;   // the upstream render page (#host): PNG and PDF keep the end state
    F.svg.querySelectorAll('[data-panel]').forEach((p, i) => { p.style.animationDelay = `${i * 60}ms`; });
  }
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  st.textContent = css;
  F.svg.insertBefore(st, F.svg.firstChild);
}
