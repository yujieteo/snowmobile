// Snowmobile pipeline for the README: one column, a kill rail on the left and a fault rail on the right.
// Style: schematic-emil (figure/emil.js). Web venue at 58 mm, so that 6 pt text is 11 px or more in the 309 px README column at a 375 px viewport.
// Hero: none, a software process has no physical object. Route: flat.
// Render (schematic-figure 09d8b6e, schematic-emil): copy the schematic-emil fonts/ to figure/fonts/, then
//   node <foundation>/tools/render.mjs --root docs/figures/pipeline --fig docs/figures/pipeline/figure/figure.js
// and copy figure/out/pipeline.svg to docs/figures/pipeline.svg.
import * as E from './emil.js';
import * as D from '../engine/cs.js';
export const figure = { width: 58, height: 93, name: 'pipeline', format: 'journal' };

export default function draw(F, L) {
  const { r, line, text } = E.useEmil(F, L, 'web');
  const p = F.root;
  const X0 = 32, W = 76, CX = X0 + W / 2;
  const main = E.gray[900], kill = E.hue.tomato[11], fault = E.hue.amber[11];
  const conn = L.group(p, { part: 'connectors' });
  const card = (name, y, h, title, sub, look = E.card(r.card)) => {
    D.box(p, look.x ?? X0, y, look.w ?? W, h, { fill: look.fill, stroke: look.stroke, width: line.thin, r: r.card, dash: look.dash, F, name });
    const cx = (look.x ?? X0) + (look.w ?? W) / 2;
    L.text(p, cx, sub ? y + h / 2 - 4 : y + h / 2, title, { size: text.label, weight: E.weight.name, anchor: 'middle', valign: 'middle', color: look.ink ?? E.gray[1200] });
    if (sub) L.text(p, cx, y + h / 2 + 5, sub, { size: text.small, anchor: 'middle', valign: 'middle', color: E.gray[1100] });
  };
  const flow = (a, b, opts = {}) => D.route(conn, [a, b], { F, stroke: opts.stroke ?? main, width: line.thin, head: 'fill', headLength: 3, headWidth: 2.6, relate: true, kind: opts.kind ?? 'flow', ...opts });

  card('seed', 6, 20, 'Seed');
  card('hunt', 40, 28, 'Hunt parts', 'web search');
  card('mix', 82, 20, 'Recombine');
  card('prior', 116, 20, 'Prior-art check');
  card('grave', 116, 20, 'Graveyard', null, { x: 119, w: 43, fill: E.hue.tomato[3], stroke: E.hue.tomato[7] });
  card('grill', 150, 28, 'Grill tree', 'one tap per round');
  card('sm', 192, 28, 'State machine', 'optional sm-axi check', { ...E.card(r.card), dash: '2 1.5' });
  card('brief', 234, 20, 'Build brief', null, { fill: E.hue.grass[3], stroke: E.hue.grass[7] });

  flow([CX, 26], [CX, 40], { relFrom: 'seed', relTo: 'hunt' });
  flow([CX, 68], [CX, 82], { relFrom: 'hunt', relTo: 'mix' });
  flow([CX, 102], [CX, 116], { relFrom: 'mix', relTo: 'prior' });
  flow([CX, 136], [CX, 150], { relFrom: 'prior', relTo: 'grill' });
  L.text(p, CX + 3, 143, 'survivor', { size: text.small, valign: 'middle', color: E.gray[1100] });
  flow([X0 + W, 126], [119, 126], { relFrom: 'prior', relTo: 'grave', stroke: kill, kind: 'exit' });
  flow([CX, 178], [CX, 192], { relFrom: 'grill', relTo: 'sm' });
  L.text(p, CX + 3, 185, 'settled', { size: text.small, valign: 'middle', color: E.gray[1100] });
  flow([CX, 220], [CX, 234], { relFrom: 'sm', relTo: 'brief' });

  // kill: back to the hunt, with the bad part marked
  D.route(conn, [[X0, 164], [12, 164], [12, 54], [X0, 54]], { F, stroke: kill, width: line.thin, head: 'fill', headLength: 3, headWidth: 2.6, radius: r.chip, relFrom: 'grill', relTo: 'hunt', kind: 'feedback', relate: true });
  const g = L.group(p, { x: 8, y: 109, rotate: -90 });
  L.text(g.node ? g : g, 0, 0, 'kill · bad part marked', { size: text.small, anchor: 'middle', valign: 'middle', color: kill, halo: true });

  // fault: the state machine check returns each fault to the grill as a decision
  D.route(conn, [[X0 + W, 206], [114, 206], [114, 164], [X0 + W, 164]], { F, stroke: fault, width: line.thin, head: 'fill', headLength: 3, headWidth: 2.6, radius: r.chip, relFrom: 'sm', relTo: 'grill', kind: 'feedback', relate: true });
  L.text(p, 118, 181, 'fault →\nnew decision', { size: text.small, valign: 'middle', color: fault });

  // restore: a swipe brings a graveyard entry back as a survivor
  D.route(conn, [[140.5, 136], [140.5, 157], [X0 + W, 157]], { F, stroke: main, width: line.thin, dash: '2 1.5', head: 'fill', headLength: 3, headWidth: 2.6, radius: r.chip, relFrom: 'grave', relTo: 'grill', kind: 'restore', relate: true });
  L.text(p, 137.5, 146, 'restore', { size: text.small, anchor: 'end', valign: 'middle', color: E.gray[1100] });

  E.emilTheme(F);
}
