import { cell, type Cell } from '../shared/fsm.ts';
import { esc, link, md, plural } from '../shared/markdown.ts';
import { onceMachine, pointMachine, swipeMachine, toastMachine } from '../shared/ui.ts';
import type { Layer } from '../src/data.ts';
import type { Decision, GrillView, HuntView, Idea, PointView, SearchView, StackView, Tree, Component, Hunt } from './api.ts';
import type { Paradigm } from '../src/stack.ts';

const T = new URLSearchParams(location.search).get('token') || '';
const app = must<HTMLElement>('#app');
let timer: ReturnType<typeof setTimeout> | undefined;
let view = 0, shownView = -1, shownHtml = '', lastTree: Tree | null = null, shownRound: string | null = null, dragging = false;

function must<E extends Element>(selector: string, root: ParentNode = document): E {
  const el = root.querySelector<E>(selector);
  if (!el) throw new Error(`the page has no ${selector}`);
  return el;
}
const all = <E extends Element>(selector: string, root: ParentNode = document): E[] => [...root.querySelectorAll<E>(selector)];
const byId = <E extends HTMLElement>(id: string): E => must<E>(`#${id}`);
const go = (h: string): void => { location.hash = h; };
const when = (t: string): string => {
  const d = new Date(`${String(t).replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? esc(t) : `<time datetime="${d.toISOString()}">${esc(d.toLocaleString())}</time>`;
};

function once<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R | undefined> {
  const gate = cell(onceMachine);
  return async (...a) => {
    if (!gate.send('run')) return undefined;
    try { return await fn(...a); } finally { gate.send('settle'); }
  };
}
const still = matchMedia('(prefers-reduced-motion: reduce)');

async function api<R>(path: string, body?: unknown): Promise<R> {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-token': T, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as R;
}

interface FocusKey { sel: string; i: number; start: number | null; end: number | null }

function focusKey(): FocusKey | null {
  const el = document.activeElement;
  if (!el || !app.contains(el)) return null;
  const sel = el.tagName + [...el.attributes].filter((a) => /^(id|href|name|aria-label|data-.*)$/.test(a.name))
    .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  const field = el as HTMLInputElement;
  return { sel, i: all(sel, app).indexOf(el), start: field.selectionStart ?? null, end: field.selectionEnd ?? null };
}

function refocus(k: FocusKey | null): boolean {
  const el = k && all<HTMLElement>(k.sel, app)[k.i];
  if (!k || !el) return false;
  el.focus({ preventScroll: true });
  if (typeof k.start === 'number' && typeof k.end === 'number') try { (el as HTMLInputElement).setSelectionRange(k.start, k.end); } catch { /* an element without a selection */ }
  return document.activeElement === el;
}

function shell(inner: string, nav?: string): void {
  const fresh = shownView !== view;
  if (!fresh && inner === shownHtml) return;
  const k = focusKey();
  shownView = view; shownHtml = inner;
  app.innerHTML = inner;
  all<HTMLElement>('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.nav === nav));
  const h1 = app.querySelector('h1');
  if (h1) h1.tabIndex = -1;
  document.title = h1 ? `${(h1.textContent ?? '').trim()} · snowmobile` : 'snowmobile';
  if (refocus(k) || !h1 || !(fresh || k)) return;
  h1.focus({ preventScroll: true });
}

interface PrimaryOptions { disabled?: boolean; busy?: boolean }

function primary(label: string, onclick?: (() => void | Promise<void>) | null, { disabled = false, busy = false }: PrimaryOptions = {}): void {
  const b = byId<HTMLButtonElement>('primary');
  b.hidden = !label;
  b.disabled = disabled || busy;
  b.innerHTML = label ? `${busy ? '<span class="spin"></span>' : ''}${esc(label)}` : '';
  b.onclick = onclick ? () => { void onclick(); } : null;
}

interface Countdown { hold(why: string): void; free(why: string): void; stop(): void; start(): void; readonly holds: number }

function countdown(ms: number, done: () => void): Countdown {
  let left = ms, at = 0, t: ReturnType<typeof setTimeout> | null = null, over = false;
  const holds = new Set<string>();
  const run = (): void => {
    if (over || holds.size || t) return;
    at = performance.now();
    t = setTimeout(() => { over = true; done(); }, left);
  };
  return {
    hold(why) { holds.add(why); if (t) { clearTimeout(t); t = null; left -= performance.now() - at; } },
    free(why) { holds.delete(why); run(); },
    stop() { over = true; if (t) clearTimeout(t); },
    start: run,
    get holds() { return holds.size; },
  };
}

const toastEl = byId<HTMLElement>('toast');
const toastState = cell(toastMachine);
let toastClock: Countdown | null = null;

function hideToast(): void {
  toastClock?.stop();
  toastState.send('dismiss');
  toastEl.classList.remove('show');
  toastEl.inert = true;
}

function toast(msg: string, undo?: (() => Promise<void> | void) | null, error = false): void {
  const b = must<HTMLButtonElement>('button', toastEl);
  must('.msg', toastEl).textContent = msg;
  toastEl.classList.toggle('error', error);
  b.hidden = !undo;
  b.onclick = async () => { hideToast(); await undo?.(); };
  toastEl.inert = false;
  toastEl.classList.add('show');
  toastState.send('show');
  toastClock?.stop();
  toastClock = countdown(undo ? 7000 : 4000, () => { toastState.send('expire'); hideToast(); });
  if (toastEl.matches(':hover')) holdToast('pointer');
  if (toastEl.contains(document.activeElement)) holdToast('focus');
  if (document.hidden) holdToast('hidden');
  toastClock.start();
}

function holdToast(why: string): void {
  toastClock?.hold(why);
  toastState.send('hold');
}

function freeToast(why: string): void {
  toastClock?.free(why);
  if (!toastClock?.holds) toastState.send('free');
}

toastEl.addEventListener('pointerenter', () => holdToast('pointer'));
toastEl.addEventListener('pointerleave', () => freeToast('pointer'));
toastEl.addEventListener('focusin', () => holdToast('focus'));
toastEl.addEventListener('focusout', () => freeToast('focus'));
document.addEventListener('visibilitychange', () => (document.hidden ? holdToast('hidden') : freeToast('hidden')));
document.addEventListener('keydown', (e) => {
  const b = must<HTMLButtonElement>('button', toastEl);
  if (e.key !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !toastEl.classList.contains('show') || b.hidden) return;
  if ((e.target as Element | null)?.closest?.('input, textarea')) return;
  e.preventDefault();
  b.click();
});
byId('skip').onclick = () => (document.querySelector<HTMLElement>('.dock nav a[aria-current]') ?? must<HTMLElement>('.dock nav a')).focus();
const fail = (e: unknown): void => toast((e as Error).message, null, true);

function poll(fn: () => unknown, ms: number): void {
  clearTimeout(timer);
  const v = view;
  timer = setTimeout(() => v === view && (dragging ? poll(fn, ms) : void fn()), ms);
}

type CardEl = HTMLElement & { swipe?: boolean };

function swipeable(card: CardEl, dir: 'left' | 'right', act: () => void): void {
  if (card.swipe) return;
  card.swipe = true;
  const sign = dir === 'left' ? -1 : 1;
  const machine: Cell<'idle' | 'pending' | 'scrolling' | 'dragging' | 'leaving', 'down' | 'move_x' | 'move_y' | 'release_far' | 'release_near' | 'done'> = cell(swipeMachine);
  let x0 = 0, y0 = 0, from = 0, x = 0, id: number | null = null, leaving: ReturnType<typeof setTimeout> | null = null;
  let track: [number, number][] = [];
  const under = card.previousElementSibling as HTMLElement;
  const set = (v: number, ease: boolean): void => {
    x = v;
    card.style.transition = ease && !still.matches ? 'transform 280ms var(--ease-out)' : 'none';
    card.style.transform = v ? `translateX(${v}px)` : '';
    under.style.opacity = String(Math.min(1, Math.abs(v) / 80) * (v * sign > 0 ? 1 : 0));
  };
  card.addEventListener('pointerdown', (e) => {
    if (dragging || e.button || (e.target as Element).closest('a, button, input, textarea')) return;
    if (!machine.send('down')) return;
    const m = new DOMMatrix(getComputedStyle(card).transform);
    if (leaving) clearTimeout(leaving);
    leaving = null;
    set(m.m41, false);
    from = x; x0 = e.clientX; y0 = e.clientY; id = e.pointerId; track = [[e.timeStamp, x]];
  });
  card.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (machine.state === 'pending' && Math.hypot(dx, dy) > 8) {
      if (Math.abs(dx) > Math.abs(dy)) {
        machine.send('move_x');
        card.setPointerCapture(e.pointerId); dragging = true; card.style.willChange = 'transform';
      } else machine.send('move_y');
    }
    if (machine.state !== 'dragging') return;
    const v = from + dx;
    set(v * sign >= 0 ? v : v / 4, false);
    track.push([e.timeStamp, x]);
    while (track.length > 2 && e.timeStamp - (track[0]?.[0] ?? 0) > 100) track.shift();
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = null; dragging = false; card.style.willChange = '';
    if (machine.state !== 'dragging') { machine.send('release_near'); if (x) set(0, true); return; }
    const [t1, x1] = track[0] ?? [e.timeStamp, x];
    const speed = (x - x1) / Math.max(1, e.timeStamp - t1);
    if (x * sign > card.offsetWidth / 3 || speed * sign > 0.4) {
      machine.send('release_far');
      set(sign * (card.offsetWidth + 40), true);
      leaving = setTimeout(() => { machine.send('done'); act(); }, still.matches ? 0 : 260);
    } else { machine.send('release_near'); set(0, true); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

const EXAMPLES = ['flaky end-to-end tests', 'code review takes days', 'CRDTs', 'spreadsheets', 'make', 'feature flags'];

async function home(): Promise<void> {
  shell(`<h1>Build new dev tools from parts of old ones.</h1>
    <p class="muted">Name a pain, a domain, a tool or a paradigm. An LLM hunts real software for its parts,
    recombines distant parts into new tools, kills the ones that already exist,
    and grills you on a survivor as a tree: one tap per decision.</p>
    <div class="steps"><span>1 hunt parts</span><span>2 recombine</span><span>3 prior-art check</span><span>4 grill tree</span><span>5 build brief</span></div>
    <form class="row" id="f"><input type="search" id="seed" placeholder="seed, e.g. flaky end-to-end tests" autocomplete="off" enterkeyhint="go" aria-label="seed"></form>
    <div>${EXAMPLES.map((e) => `<button type="button" class="button chip ex">${esc(e)}</button>`).join('')}</div>
    <h2>Recent hunts</h2><div id="recent" class="list muted">…</div>`, 'home');
  const seed = byId<HTMLInputElement>('seed');
  const start = once(async () => {
    primary('Hunt', null, { busy: true });
    try { const { id } = await api<{ id: number }>('/api/hunts', { seed: seed.value }); go(`#/hunt/${id}`); }
    catch (err) { fail(err); primary('Hunt', start); seed.focus(); }
  });
  primary('Hunt', start);
  all<HTMLButtonElement>('.ex').forEach((b) => (b.onclick = () => { seed.value = b.textContent ?? ''; seed.focus(); }));
  byId<HTMLFormElement>('f').onsubmit = (e) => { e.preventDefault(); void start(); };
  const { hunts } = await api<SearchView>('/api/search?q=');
  byId('recent').innerHTML = hunts.length
    ? hunts.slice(0, 20).map((h: Hunt) => `<a href="#/hunt/${h.id}"><b>${esc(h.seed)}</b> <span class="small muted">${esc(h.status)} · ${when(h.created_at)}</span></a>`).join('')
    : 'None yet.';
}

const STEP: Record<string, string> = { hunting: 'Hunting real software for parts. This takes a few minutes of web search.',
  creating: 'Recombining parts and searching for prior art. This takes a few minutes.' };
const MARK: Record<string, string> = { survivor: '●', grilled: '✓', killed: '✕', graveyard: '✝' };

function caseOf(s: Idea): string {
  if (!s.problem) return '';
  return `<div class="small" style="margin:8px 0">
    <div><b>Problem:</b> ${esc(s.problem)} ${link(s.evidence_url, '(evidence)')}</div>
    ${s.practical_problems?.length ? `<div><b>Practical problems:</b> ${s.practical_problems.map((p) => esc(p.name)).join(', ')} · priority ${s.problem_priority}% respondent share</div>` : ''}
    <div><b>Today:</b> ${esc(s.conventional)}</div>
    <div><b>Better on ${esc(s.gain_axis)}:</b> ${esc(s.gain)}</div>
    ${s.mismatch ? `<div><b>Layer mismatch:</b> ${esc(s.mismatch)}</div>` : ''}</div>`;
}

function smCard(s: Idea, comps: Record<number, Component>, first: boolean): string {
  const parts = s.component_ids.map((i) => comps[i]).filter((c): c is Component => Boolean(c))
    .map((c) => `<span class="chip ${c.bad_reason ? 'bad' : ''}">${esc(c.name)}</span>`).join('');
  const dir = ({ survivor: 'left', graveyard: 'right' } as Record<string, string>)[s.status];
  const open = s.status === 'survivor' || s.status === 'grilled' || s.status === 'killed';
  const card = `<div class="card" data-sm="${s.id}"><div class="tag">${MARK[s.status] || ''} ${esc(s.status)}</div><b>${esc(s.name)}</b>
    ${caseOf(s)}<div class="muted">${esc(s.pitch)}</div><div>${parts}</div>
    <p class="small muted">${s.status === 'graveyard' && s.proof_url ? `Exists: ${link(s.proof_url, s.proof_url)}. ` : ''}${esc(s.proof_note)}</p>
    <div class="actions">${open ? `<a class="button btn ${s.status === 'survivor' ? '' : 'ghost'}" href="#/grill/${s.id}">${s.status === 'survivor' ? 'Grill me' : 'Open tree'}</a>` : ''}
      ${dir === 'left' ? `<button class="button quiet" data-move="graveyard">✝ Bury</button>${first ? '<span class="hint">or swipe left</span>' : ''}` : ''}
      ${dir === 'right' ? `<button class="button ghost" data-move="survivor">↺ Restore</button>${first ? '<span class="hint">or swipe right</span>' : ''}` : ''}</div></div>`;
  return dir ? `<div class="swipe"><div class="under ${dir}">${dir === 'left' ? '✝ Bury' : '↺ Restore'}</div>${card}</div>` : card;
}

async function hunt(id: string | number, tabIn?: string): Promise<void> {
  const { hunt: h, sources, snowmobiles, problemCoverage } = await api<HuntView>(`/api/hunts/${id}`);
  const comps: Record<number, Component> = {};
  sources.forEach((s) => s.components.forEach((c) => (comps[c.id] = { ...c, source: s.name })));
  const busy = h.status === 'hunting' || h.status === 'creating';
  const ideas = snowmobiles.filter((s) => s.status !== 'graveyard'), grave = snowmobiles.filter((s) => s.status === 'graveyard');
  const nParts = Object.keys(comps).length;
  const tab = tabIn || (ideas.length || h.status === 'creating' ? 'ideas' : grave.length ? 'graveyard' : 'parts');
  const tabs: [string, string, number][] = [['ideas', 'Ideas', ideas.length], ['graveyard', 'Graveyard', grave.length], ['parts', h.stack ? 'Stack' : 'Parts', nParts]];
  let body: string;
  if (tab === 'parts') {
    body = `${h.stack ? '<p class="small"><a href="#/stack">Open the stack map</a></p>' : `<div class="actions" style="margin:0 0 16px">
        <button id="more" class="button ghost" ${busy ? 'disabled' : ''}>＋ Hunt more parts</button></div>`}
      <p class="small muted">A part that you leave out stays out of the next creation. A kill in the grill also leaves out a part.</p>
      <div class="grid">${sources.map((s) => `<div class="card"><span class="tag">${esc(s.kind)}</span>
        <div><b>${link(s.url, s.name)}</b></div><div class="small muted">${esc(s.summary)}</div>
        ${s.components.map((c) => `<div class="part ${c.bad_reason ? 'out' : ''}"><div class="what"><b class="name">${link(c.url, c.name)}</b>
          <div class="small">${esc(c.mechanism)}</div>${c.bad_reason ? `<div class="small err">✕ Left out: ${esc(c.bad_reason)}</div>` : ''}</div>
          <button class="button ${c.bad_reason ? 'ghost' : 'quiet'}" data-part="${c.id}" data-out="${c.bad_reason ? '' : '1'}">${c.bad_reason ? '↺ Bring back' : '✕ Leave out'}</button></div>`).join('')}
      </div>`).join('') || `<p class="muted">${busy ? '…' : 'No parts yet.'}</p>`}</div>`;
  } else if (tab === 'graveyard') {
    body = grave.length ? `<p class="small muted">Ideas that already exist, have no clear problem or gain, or that you buried. Restore one to grill it.</p>
      <div class="grid">${grave.map((s, i) => smCard(s, comps, !i)).join('')}</div>` : '<p class="muted">The graveyard is empty.</p>';
  } else {
    const groups = ([['survivor', 'Survivors'], ['grilled', 'Grilled'], ['killed', 'Killed in the grill']] as [string, string][])
      .map(([st, title]): [string, Idea[]] => [title, ideas.filter((s) => s.status === st)]).filter(([, l]) => l.length);
    body = groups.map(([title, list], g) => `<h2>${title}</h2><div class="grid">${list.map((s, i) => smCard(s, comps, !g && !i)).join('')}</div>`).join('')
      || `<p class="muted">${busy ? '…' : 'No ideas yet. Create them from the parts.'}</p>`;
  }
  shell(`<h1>${esc(h.seed)}</h1>
    <div class="status">${busy ? `<span class="spin"></span> ${STEP[h.status]}` : ''}
      ${h.error ? `<div class="err">${esc(h.error)}</div>` : ''}</div>
    <nav class="tabs">${tabs.map(([k, label, n]) => `<a href="#/hunt/${id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${label} <span class="n">${n}</span></a>`).join('')}</nav>
    ${problemCoverage ? `<p class="small muted">${problemCoverage.named}/${problemCoverage.total} candidates name a sourced practical problem${problemCoverage.share === null ? '' : ` (${Math.round(problemCoverage.share * 100)}%)`}.
      Ideas with a greater respondent share appear first. ${esc(problemCoverage.limit)}
      ${link(problemCoverage.source.url, problemCoverage.source.title)}. ${esc(problemCoverage.source.limit)}</p>` : ''}
    ${body}`, 'home');
  const label = h.stack ? 'Create more apps' : 'Create ideas';
  const create = once(async () => {
    primary(label, null, { busy: true });
    try { await api(`/api/hunts/${id}/create`, {}); } catch (e) { fail(e); primary(label, create); return; }
    if (location.hash === `#/hunt/${id}/ideas`) void hunt(id, 'ideas'); else go(`#/hunt/${id}/ideas`);
  });
  primary(busy ? (h.status === 'hunting' ? 'Hunting…' : 'Creating…') : label, create, { busy, disabled: !sources.length });
  const more = document.getElementById('more') as HTMLButtonElement | null;
  if (more) more.onclick = () => void once(async () => {
    more.disabled = true;
    try { await api(`/api/hunts/${id}/hunt`, {}); void hunt(id, 'parts'); } catch (e) { fail(e); more.disabled = false; }
  })();
  const move = async (sid: number, status: string): Promise<void> => {
    const idea = snowmobiles.find((s) => s.id === sid);
    if (!idea) return;
    try { await api(`/api/snowmobiles/${sid}`, { status }); } catch (e) { fail(e); return hunt(id, tab); }
    void hunt(id, tab);
    toast(`${status === 'graveyard' ? 'Buried' : 'Restored'} ${idea.name}.`, async () => {
      try { await api(`/api/snowmobiles/${sid}`, { status: status === 'graveyard' ? 'survivor' : 'graveyard', proof_note: idea.proof_note }); } catch (e) { fail(e); }
      void hunt(id, tab);
    });
  };
  all<CardEl>('[data-sm]').forEach((card) => {
    const b = card.querySelector<HTMLButtonElement>('[data-move]');
    if (!b) return;
    const sid = Number(card.dataset.sm), to = b.dataset.move ?? '';
    b.onclick = () => void move(sid, to);
    swipeable(card, to === 'graveyard' ? 'left' : 'right', () => void move(sid, to));
  });
  all<HTMLButtonElement>('[data-part]').forEach((b) => (b.onclick = async () => {
    const pid = Number(b.dataset.part), out = !!b.dataset.out, part = comps[pid];
    if (!part) return;
    const flip = async (o: boolean, why?: string | null): Promise<void> => {
      try { await api(`/api/components/${pid}`, { out: o, reason: why }); } catch (e) { fail(e); }
      void hunt(id, 'parts');
    };
    await flip(out);
    toast(`${out ? 'Left out' : 'Brought back'} ${part.name}.`, () => flip(!out, part.bad_reason));
  }));
  if (busy) poll(() => hunt(id, tab), 2000);
}

interface Pick { choice: number; note: string }
const picks: Record<string, Pick> = {};

function drawEdges(tree: Tree): void {
  const box = document.querySelector<HTMLElement>('.tree');
  if (!box) return;
  const at = box.getBoundingClientRect();
  const paths: string[] = [];
  const pt = (el: Element, top: boolean): [number, number] => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - at.left, (top ? r.top : r.bottom) - at.top];
  };
  for (const d of tree.decisions.filter((x) => x.answer)) {
    const child = box.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
    const parents = d.depends_on.length ? d.depends_on : ['__root'];
    for (const pid of parents) {
      const parent = box.querySelector(`[data-id="${CSS.escape(pid)}"]`);
      if (!child || !parent) continue;
      const [x1, y1] = pt(parent, false), [x2, y2] = pt(child, true);
      const my = (y1 + y2) / 2;
      paths.push(`<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`);
    }
  }
  must('svg', box).innerHTML = paths.join('');
}

async function grill(id: string | number, data?: GrillView): Promise<void> {
  const g = data ?? await api<GrillView>(`/api/grills/${id}`);
  const { snowmobile: sm, tree } = g;
  const comps: Record<number, Component> = Object.fromEntries(g.components.map((c) => [c.id, c]));
  const open = tree.decisions.filter((d) => !d.answer);
  const pickOf = (did: string): Pick => {
    const key = `${id}:${did}`;
    return (picks[key] ??= { choice: open.find((d) => d.id === did)?.recommended ?? -1, note: '' });
  };
  for (const d of open) pickOf(d.id);
  const rounds: Decision[][] = [];
  tree.decisions.forEach((d) => (rounds[d.round] ||= []).push(d));
  const lastAnswered = Math.max(0, ...tree.decisions.filter((d) => d.answer).map((d) => d.round));
  const key = `${id}:${tree.round}`;
  const arrived = open.length > 0 && shownRound !== key && Boolean(shownRound?.startsWith(`${id}:`));
  const answered = (d: Decision): string => {
    const a = d.answer;
    return `<div class="node" data-id="${esc(d.id)}"><div class="q">${esc(d.question)}</div>
      <div class="a">${a && a.choice >= 0 ? esc(d.options[a.choice]?.label) : '(own answer)'}</div>
      ${a?.note ? `<div class="small muted">“${esc(a.note)}”</div>` : ''}</div>`;
  };
  const names = Object.fromEntries(tree.decisions.map((d) => [d.id, d.question]));
  const asking = (d: Decision, i: number): string => `<div class="node open${arrived ? ' enter' : ''}" style="--i:${i}" data-id="${esc(d.id)}"><div class="q">${esc(d.question)}</div>
    ${d.depends_on.length ? `<div class="small muted">builds on: ${d.depends_on.map((x) => esc(names[x] || x)).join(' · ')}</div>` : ''}
    <div class="opts" role="radiogroup">${d.options.map((o, n) => `<button class="button opt ${pickOf(d.id).choice === n ? 'on' : ''} ${o.kills_component_id ? 'kills' : ''}" role="radio"
      aria-checked="${pickOf(d.id).choice === n}" data-d="${esc(d.id)}" data-i="${n}">
      <span class="flags">${n === d.recommended ? '<span class="rec">★ recommended</span>' : ''}${o.kills_component_id ? '<span class="rec">✕ kills the idea</span>' : ''}<span class="sel">✓ picked</span></span>
      <b>${esc(o.label)}</b><span class="why">${esc(o.why)}</span></button>`).join('')}</div>
    <textarea data-note="${esc(d.id)}" rows="1" placeholder="optional note, or your own answer" aria-label="note for ${esc(d.question)}">${esc(pickOf(d.id).note)}</textarea>
    <div class="need" data-need="${esc(d.id)}" hidden>Pick a card, or write your own answer.</div></div>`;
  const undoBtn = (label: string): string => `<button class="button ghost" data-undo>↶ ${label}</button>`;
  const killedPart = tree.killed ? comps[tree.killed.component_id] : undefined;
  shell(`<div class="top"><a class="back" href="#/hunt/${sm.hunt_id}">‹ Hunt</a></div>
    <h1>${esc(sm.name)}</h1><div class="muted">${esc(sm.pitch)}</div>
    <div>${g.components.map((c) => `<span class="chip ${c.bad_reason ? 'bad' : ''}">${link(c.url, c.name)} <span class="muted">· ${esc(c.source)}</span></span>`).join('')}</div>
    ${g.status === 'killed' ? `<div class="banner"><b>✕ Killed.</b> ${esc(tree.killed?.reason)}<br>
      ${killedPart ? `Bad part: <b>${esc(killedPart.name)}</b>. It is left out of the next creation.` : ''}
      <div class="actions">${lastAnswered ? undoBtn('Undo the kill') : ''}</div></div>` : ''}
    ${open.length ? '<p class="small muted">Each round starts with the recommended cards picked. Tap a card to pick it. Tap a picked card again to clear it and write your own answer.</p>' : ''}
    <div class="tree"><svg></svg>
      <div class="level"><div class="node root" data-id="__root"><b>${esc(sm.name)}</b></div></div>
      ${rounds.map((list, r) => list ? `<div class="level">${list.map((d, i) => d.answer ? answered(d) : asking(d, i)).join('')}</div>
        ${r === lastAnswered && g.status === 'open' ? `<div class="undo-round">${undoBtn('Undo this round')}</div>` : ''}` : '').join('')}
      ${g.pending ? `<div class="level"><div class="node"><span class="spin"></span> next round…</div></div>` : ''}
      ${g.error ? `<div class="err">${esc(g.error)}</div><button class="button" id="retry">Retry</button>` : ''}
    </div>
    ${g.status === 'done' ? `<h2><span class="grow">Build brief</span>${undoBtn('Undo the last round')}</h2><div class="card brief" id="brief">${md(g.brief ?? '')}</div>` : ''}`, 'home');
  lastTree = tree;
  drawEdges(tree);
  if (arrived) document.querySelector('.node.open')?.scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth', block: 'start' });
  shownRound = key;
  all<HTMLButtonElement>('.opt').forEach((b) => (b.onclick = () => {
    const did = b.dataset.d ?? '', p = pickOf(did), i = Number(b.dataset.i);
    p.choice = p.choice === i ? -1 : i;
    all<HTMLElement>(`.opt[data-d="${CSS.escape(did)}"]`).forEach((o) => {
      o.classList.toggle('on', Number(o.dataset.i) === p.choice); o.setAttribute('aria-checked', String(Number(o.dataset.i) === p.choice));
    });
    must<HTMLElement>(`[data-need="${CSS.escape(did)}"]`).hidden = true;
  }));
  all<HTMLTextAreaElement>('[data-note]').forEach((t) => (t.oninput = () => { pickOf(t.dataset.note ?? '').note = t.value; }));
  const answer = async (): Promise<void> => {
    const missing = open.filter((d) => pickOf(d.id).choice < 0 && !pickOf(d.id).note.trim());
    missing.forEach((d) => { must<HTMLElement>(`[data-need="${CSS.escape(d.id)}"]`).hidden = false; });
    const firstMissing = missing[0];
    if (firstMissing) return must(`[data-id="${CSS.escape(firstMissing.id)}"]`).scrollIntoView({ block: 'center' });
    primary('Answering…', null, { busy: true });
    try { void grill(id, await api<GrillView>(`/api/grills/${id}/answer`, { answers: Object.fromEntries(open.map((d) => [d.id, pickOf(d.id)])) })); }
    catch (e) { fail(e); void grill(id); }
  };
  if (open.length) primary('Answer round', answer);
  else if (g.status === 'done') primary('Copy brief', async () => {
    try { await navigator.clipboard.writeText(g.brief ?? ''); toast('Copied the build brief.'); }
    catch { getSelection()?.selectAllChildren(byId('brief')); toast('Select all is on. Copy it with the menu.'); }
  });
  else if (g.status === 'killed') primary('Back to the hunt', () => go(`#/hunt/${sm.hunt_id}`));
  else primary(g.pending ? 'Thinking…' : '', null, { busy: g.pending });
  all<HTMLButtonElement>('[data-undo]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { void grill(id, await api<GrillView>(`/api/grills/${id}/undo`, {})); toast('The last round is open again.'); } catch (e) { fail(e); b.disabled = false; }
  }));
  const retry = document.getElementById('retry');
  if (retry) retry.onclick = async () => { try { void grill(id, await api<GrillView>(`/api/grills/${id}/retry`, {})); } catch (e) { fail(e); } };
  if (g.pending) poll(() => grill(id), 600);
}

const stackPick: Partial<Record<Layer, number>> = {};
let tapped: (Partial<PointView> & { x: number; y: number; busy: boolean; error?: string }) | null = null;
const pointState = cell(pointMachine);
let lastMap: { s: StackView; byId: Record<number, Paradigm> } | null = null;
const SHAPE: Record<Layer, (x: number, y: number, r: number) => string> = {
  language: (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`,
  hardware: (x, y, r) => `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5"/>`,
  os: (x, y, r) => `<path d="M${x},${y - r * 1.2} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8}Z"/>`,
  software: (x, y, r) => `<path d="M${x},${y - r * 1.3} L${x + r * 1.3},${y} L${x},${y + r * 1.3} L${x - r * 1.3},${y}Z"/>`,
};
const mark = (layer: Layer, x: number, y: number, r: number, cls = 'mark'): string => `<g class="${cls}">${SHAPE[layer](x, y, r)}</g>`;
const JOB: Record<string, string> = { axes: 'Proposing the design axes.', scoring: 'Scoring each paradigm on each axis.', hunting: 'Hunting the web for more paradigms.' };

function pcLabel(s: StackView, i: number): string {
  const v = s.map?.components[i] ?? [];
  const top = s.axes.map((a, j): [typeof a, number] => [a, v[j] ?? 0]).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 3);
  return `${i ? 'Up' : 'Across'} (PC${i + 1}, ${Math.round(100 * (s.map?.explained[i] ?? 0))}% of the spread): ${top.map(([a, w]) => `${esc(a.name)} ${w >= 0 ? '+' : '−'}${Math.abs(w).toFixed(2)}`).join(', ')}`;
}

async function askAt(x: number, y: number, s: StackView, byParadigm: Record<number, Paradigm>): Promise<void> {
  const v = view;
  pointState.send('tap');
  const mine = { x, y, busy: true } as NonNullable<typeof tapped>;
  tapped = mine;
  drawMap(s, byParadigm);
  try { Object.assign(mine, await api<PointView>('/api/stack/point', { x, y }), { busy: false }); pointState.send('answer'); }
  catch (err) { Object.assign(mine, { busy: false, error: (err as Error).message }); pointState.send('error'); }
  if (v === view && tapped === mine) showPoint(byParadigm);
}

function choose(p: Paradigm): void {
  if (stackPick[p.layer] === p.id) delete stackPick[p.layer]; else stackPick[p.layer] = p.id;
  void stack();
}

async function stack(): Promise<void> {
  const ids = Object.values(stackPick).filter((x): x is number => x !== undefined);
  const s = await api<StackView>(`/api/stack?pick=${ids.join(',')}`);
  const byParadigm: Record<number, Paradigm> = Object.fromEntries(s.paradigms.map((p) => [p.id, p]));
  const busy = Boolean(s.job && !s.job.error);
  const unscored = s.paradigms.filter((p) => s.axes.some((a) => !s.scores[p.id]?.[a.id])).length;
  const picked = ids.map((i) => byParadigm[i]).filter((p): p is Paradigm => Boolean(p));
  const pain = (document.getElementById('pain') as HTMLInputElement | null)?.value || '';
  const layers = Object.entries(s.layers) as [Layer, string][];
  const problemName = (pid: string): string => esc(s.practicalProblems.items.find((p) => p.id === pid)?.name);
  shell(`<h1>Stack</h1>
    <p class="muted">Paradigms of 4 layers on one map. A large gap between the layers of your stack is a mismatch:
    a chance for an app or developer tool that reduces a practical problem.</p>
    <div class="status">${busy ? `<span class="spin"></span> ${JOB[s.job?.step ?? ''] ?? ''}` : ''}${s.job?.error ? `<div class="err">${esc(s.job.error)}</div>` : ''}</div>
    <div class="legend">${layers.map(([k, v]) => `<span><svg width="14" height="14">${mark(k, 7, 7, 5)}</svg>${esc(v)}</span>`).join('')}</div>
    ${s.map ? `<div class="map" id="map"></div><p class="hint">Tap a mark to pick it for its layer. Tap an empty point to ask which paradigm would live there.</p>
      <details><summary>Ask about a point by its position</summary><form class="row" id="ask-point">
        ${[0, 1].map((i) => { const v = (s.map?.points ?? []).map((p) => p[i] ?? 0), lo = Math.min(...v).toFixed(1), hi = Math.max(...v).toFixed(1);
          return `<input type="number" step="any" name="${'xy'[i]}" required placeholder="${i ? 'up' : 'across'} ${lo} to ${hi}" aria-label="${i ? 'up' : 'across'}, from ${lo} to ${hi}">`; }).join('')}
        <button class="button">Ask</button></form></details>
      <div id="point"></div><p class="small muted">${pcLabel(s, 0)}<br>${pcLabel(s, 1)}</p>`
      : `<div class="card muted">The map needs axes and a score for each paradigm. <a href="#axes" data-jump>Propose the axes below.</a></div>`}
    <h2>Practical problems</h2>
    <p class="small muted">${plural(s.practicalProblems.items.length, 'sourced problem', 'sourced problems')} · ${plural(s.practicalProblems.links.length, 'paradigm-problem link', 'paradigm-problem links')}. Select a problem as your app seed.</p>
    <div class="card">
      <p><b>Whole database: problems without a documented reduction:</b> ${s.practicalProblems.coverage.withoutReduction.map(problemName).join(', ') || 'None'}.</p>
      ${s.practicalProblems.items.map((p) => `<div>
        <button type="button" class="button chip" data-problem="${esc(p.id)}">${esc(p.name)} · ${p.percent}%</button>
        ${s.practicalProblems.links.filter((l) => l.problem_id === p.id).map((l) => `<p class="small">
          <button type="button" class="button chip" data-pick="${l.paradigm_id}" aria-pressed="${ids.includes(l.paradigm_id)}">${esc(l.paradigm)}${ids.includes(l.paradigm_id) ? ' · in your stack' : ''}</button>
          <b>${esc(l.effect)}</b>: ${esc(l.reason)} ${link(l.source.url, l.source.title)}</p>`).join('')}
        </div>`).join('')}
      <p class="small muted">${plural(s.practicalProblems.coverage.unassessedParadigms, 'paradigm has', 'paradigms have')} no problem assessment. ${esc(s.practicalProblems.coverage.limit)}</p>
      <p class="small">${link(s.practicalProblems.source.url, s.practicalProblems.source.title)} · ${s.practicalProblems.source.respondents.toLocaleString()} respondents</p>
      <p class="small muted">${esc(s.practicalProblems.source.scope)} ${esc(s.practicalProblems.source.measure)}</p>
      <p class="small muted">${esc(s.practicalProblems.source.limit)}</p>
    </div>
    <h2>Your stack</h2>
    <div class="slots">${layers.map(([k, v]) => {
      const p = byParadigm[stackPick[k] ?? -1];
      return `<div class="card slot ${p ? '' : 'empty'}"><svg width="16" height="16">${mark(k, 8, 8, 6)}</svg><div class="what"><div class="tag">${esc(v)}</div>
        ${p ? `<b>${link(p.url, p.name)}</b><div class="small muted">${esc(p.summary)}</div>` : '<span class="muted">any (the LLM chooses)</span>'}</div>
        ${p ? `<button class="button x" data-clear="${k}" aria-label="clear ${esc(v)}">×</button>` : ''}</div>`;
    }).join('')}</div>
    ${s.selectedProblemCoverage ? `<div class="card" id="selected-problem-coverage">
      <p><b>Your stack: problems without a documented reduction:</b> ${s.selectedProblemCoverage.withoutReduction.map(problemName).join(', ') || 'None'}.</p>
      <p class="small muted">${plural(s.selectedProblemCoverage.unassessedParadigms, 'selected paradigm has', 'selected paradigms have')} no problem assessment. Empty layers remain open for Claude to choose.</p>
      <p class="small muted">${esc(s.selectedProblemCoverage.limit)}</p>
    </div>` : ''}
    <form class="row" id="f"><input type="text" id="pain" placeholder="a practical problem (optional with a stack)" autocomplete="off" aria-label="practical problem" value="${esc(pain)}">
      <button class="button">Create apps</button></form>
    <p class="small muted">With a pain and no stack, the LLM chooses a paradigm for each layer.</p>
    ${s.gaps.length ? `<h2>Gaps on each axis</h2><p class="small muted">Edit a score to correct it. A new score from the LLM never replaces your edit.</p>
      <div class="scroll"><table class="gaps"><tr><th>axis</th><th>gap</th>${picked.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>
      ${[...s.gaps].sort((a, b) => b.gap - a.gap).map((g) => {
        const a = s.axes.find((x) => x.id === g.axis_id);
        if (!a) return '';
        return `<tr><td><b>${esc(a.name)}</b><div class="small muted">0 ${esc(a.low)} · 10 ${esc(a.high)}</div></td>
          <td class="${g.mismatch ? 'm' : ''}">${g.gap}${g.mismatch ? ' ⚠ mismatch' : ''}<div class="gapbar ${g.mismatch ? 'm' : ''}" style="width:${g.gap * 10}%"></div></td>
          ${picked.map((p) => { const sc = s.scores[p.id]?.[a.id];
            return `<td><input type="number" min="0" max="10" inputmode="numeric" data-p="${p.id}" data-a="${a.id}" value="${sc ? sc.score : ''}" aria-label="${esc(p.name)} on ${esc(a.name)}">
              <div class="small muted">${esc(sc?.reason)}</div></td>`; }).join('')}</tr>`;
      }).join('')}</table></div>` : ''}
    <h2><span class="grow">Paradigms</span><button id="more" class="button ghost" ${busy ? 'disabled' : ''}>＋ Hunt more paradigms</button></h2>
    ${layers.map(([k, v]) => `<div style="margin-bottom:12px"><div class="tag">${esc(v)}</div>
      ${s.paradigms.filter((p) => p.layer === k).map((p) => `<button type="button" class="button chip" aria-pressed="${stackPick[k] === p.id}" data-pick="${p.id}">${stackPick[k] === p.id ? '✓ ' : ''}${esc(p.name)}</button>`).join('')}</div>`).join('')}
    <h2 id="axes"><span class="grow">Axes</span>${!s.axes.length || unscored ? `<button class="button" id="prep" ${busy ? 'disabled' : ''}>${s.axes.length ? `Score ${plural(unscored, 'paradigm', 'paradigms')}` : 'Propose axes and score'}</button>` : ''}</h2>
    ${s.axes.length ? `<details><summary>Edit the ${plural(s.axes.length, 'axis', 'axes')}</summary>${s.axes.map((a) => `<form class="axis" data-axis="${a.id}">
      <input type="text" name="name" value="${esc(a.name)}" aria-label="name"><input type="text" name="low" value="${esc(a.low)}" aria-label="0 means">
      <input type="text" name="high" value="${esc(a.high)}" aria-label="10 means"><button class="button ghost">Save</button></form>`).join('')}</details>`
      : '<p class="small muted">Claude proposes 8 to 12 design axes that run through all 4 layers, then scores each paradigm on each axis.</p>'}`, 'stack');

  all<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => { const p = byParadigm[Number(b.dataset.pick)]; if (p) choose(p); }));
  all<HTMLButtonElement>('[data-problem]').forEach((b) => (b.onclick = () => {
    const problem = s.practicalProblems.items.find((p) => p.id === b.dataset.problem);
    const input = byId<HTMLInputElement>('pain');
    input.value = `Reduce ${(problem?.name ?? '').toLowerCase()}.`;
    input.focus();
  }));
  all<HTMLButtonElement>('[data-clear]').forEach((b) => (b.onclick = () => {
    const layer = b.dataset.clear as Layer, was = stackPick[layer];
    delete stackPick[layer]; void stack();
    toast(`Cleared ${s.layers[layer]}.`, () => { if (was !== undefined) stackPick[layer] = was; void stack(); });
  }));
  const jump = document.querySelector<HTMLAnchorElement>('[data-jump]');
  if (jump) jump.onclick = (e) => { e.preventDefault(); byId('axes').scrollIntoView(); };
  const job = (step: string) => async (): Promise<void> => { try { await api(`/api/stack/${step}`, {}); void stack(); } catch (e) { fail(e); } };
  const prep = document.getElementById('prep');
  if (prep) prep.onclick = job('axes');
  byId('more').onclick = job('hunting');
  const undoing = (path: string, body: unknown) => async (): Promise<void> => { try { await api(path, body); } catch (e) { fail(e); } void stack(); };
  all<HTMLInputElement>('.gaps input').forEach((i) => (i.onchange = async () => {
    const p = Number(i.dataset.p), a = Number(i.dataset.a), was = s.scores[p]?.[a];
    if (i.value !== '') try {
      await api('/api/scores', { paradigm_id: p, axis_id: a, score: Number(i.value) });
      toast(`Scored ${byParadigm[p]?.name} ${i.value}.`, was ? undoing('/api/scores', { paradigm_id: p, axis_id: a, score: was.score, reason: was.reason }) : null);
    } catch (e) { fail(e); }
    void stack();
  }));
  all<HTMLFormElement>('[data-axis]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const old = s.axes.find((a) => a.id === Number(f.dataset.axis));
    if (!old) return;
    try {
      await api(`/api/axes/${f.dataset.axis}`, Object.fromEntries(new FormData(f)));
      toast('Saved the axis.', undoing(`/api/axes/${f.dataset.axis}`, { name: old.name, low: old.low, high: old.high })); void stack();
    } catch (err) { fail(err); }
  }));
  const askForm = document.getElementById('ask-point') as HTMLFormElement | null;
  if (askForm) askForm.onsubmit = (e) => {
    e.preventDefault();
    const field = (n: string): number => Number((askForm.elements.namedItem(n) as HTMLInputElement).value);
    void askAt(field('x'), field('y'), s, byParadigm);
  };
  const create = once(async () => {
    primary('Create apps', null, { busy: true });
    try { const { id } = await api<{ id: number }>('/api/hunts', { seed: byId<HTMLInputElement>('pain').value, stack: ids }); go(`#/hunt/${id}`); }
    catch (err) { fail(err); primary('Create apps', create); }
  });
  byId<HTMLFormElement>('f').onsubmit = (e) => { e.preventDefault(); void create(); };
  primary('Create apps', create);
  lastMap = s.map ? { s, byId: byParadigm } : null;
  if (s.map) drawMap(s, byParadigm);
  if (busy) poll(stack, 1500);
}

function drawMap(s: StackView, byParadigm: Record<number, Paradigm>): void {
  const box = byId('map');
  const map = s.map;
  if (!map) return;
  const W = box.clientWidth, H = Math.round(Math.min(560, Math.max(340, W * (W < 600 ? 1.05 : 0.6)))), pad = 28;
  const r0 = W < 600 ? 6 : 5;
  const xs = map.points.map((p) => p[0] ?? 0), ys = map.points.map((p) => p[1] ?? 0);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (W - 2 * pad) / ((x1 - x0) || 1), sy = (H - 2 * pad) / ((y1 - y0) || 1);
  const px = (x: number): number => pad + (x - x0) * sx, py = (y: number): number => H - pad - (y - y0) * sy;
  const on = new Set(Object.values(stackPick));
  interface Dot { p: Paradigm; x: number; y: number; label?: boolean }
  const dots: Dot[] = map.ids.flatMap((id, i): Dot[] => {
    const p = byParadigm[id], pt = map.points[i];
    return p && pt ? [{ p, x: px(pt[0] ?? 0), y: py(pt[1] ?? 0) }] : [];
  });
  dots.sort((a, b) => Number(on.has(a.p.id)) - Number(on.has(b.p.id)));
  const boxes: number[][] = [];
  for (const d of [...dots].reverse()) {
    const w = d.p.name.length * (on.has(d.p.id) ? 7 : 6), left = d.x > W / 2 ? d.x - 10 - w : d.x + 10;
    const b = [left, d.y - 8, left + w, d.y + 6] as [number, number, number, number];
    d.label = !boxes.some((o) => b[0] < (o[2] ?? 0) && (o[0] ?? 0) < b[2] && b[1] < (o[3] ?? 0) && (o[1] ?? 0) < b[3]);
    if (d.label) boxes.push(b);
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
    <line class="zero" x1="${px(0)}" y1="0" x2="${px(0)}" y2="${H}"/><line class="zero" x1="0" y1="${py(0)}" x2="${W}" y2="${py(0)}"/>
    ${dots.map((d) => `${mark(d.p.layer, d.x, d.y, on.has(d.p.id) ? r0 + 2 : r0, on.has(d.p.id) ? 'mark on' : 'mark')}${on.has(d.p.id) ? `<circle class="ring" cx="${d.x}" cy="${d.y}" r="13"/>` : ''}
      ${d.label ? `<text class="${on.has(d.p.id) ? 'on' : ''}" ${d.x > W / 2 ? `text-anchor="end" x="${d.x - 10}"` : `x="${d.x + 10}"`} y="${d.y + 4}">${on.has(d.p.id) ? '✓ ' : ''}${esc(d.p.name)}</text>` : ''}`).join('')}
    ${tapped ? `<circle class="ring" cx="${px(tapped.x)}" cy="${py(tapped.y)}" r="10" stroke-dasharray="3 3"/>` : ''}</svg>`;
  box.dataset.w = String(W);
  showPoint(byParadigm);
  must<SVGElement>('svg', box).onclick = (e) => {
    const r = box.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = dots.map((d) => ({ d, dist: Math.hypot(d.x - mx, d.y - my) })).sort((a, b) => a.dist - b.dist)[0];
    if (hit && hit.dist <= 22) return choose(hit.d.p);
    void askAt(x0 + (mx - pad) / sx, y0 + (H - pad - my) / sy, s, byParadigm);
  };
}

function showPoint(byParadigm: Record<number, Paradigm>): void {
  const el = document.getElementById('point');
  if (!el || !tapped) return;
  const t = tapped, a = t.answer;
  const known = a && Object.values(byParadigm).find((p) => p.name.toLowerCase() === String(a.name).toLowerCase());
  el.innerHTML = `<div class="sheet">${t.busy ? '<span class="spin"></span> Asking which paradigm would live at this point…'
    : t.error || !a ? `<span class="err">${esc(t.error)}</span>`
    : `<div class="tag">${esc(a.layer)} · ${known ? 'on the map' : a.exists ? 'exists' : 'missing from the map'}</div><b>${link(a.url, a.name)}</b>
      <div class="small">${esc(a.why)}</div>`}
    <div class="actions">${known ? `<button class="button ghost" id="pick-point">${stackPick[known.layer] === known.id ? '✓ Picked' : 'Pick for the stack'}</button>` : ''}
      <button class="button quiet" id="close-point">Close</button></div></div>`;
  if (known) byId('pick-point').onclick = () => choose(known);
  byId('close-point').onclick = () => { pointState.send('close'); tapped = null; el.innerHTML = ''; if (lastMap) drawMap(lastMap.s, lastMap.byId); };
}

async function library(q = ''): Promise<void> {
  shell(`<h1>Library</h1><form class="row" id="f"><input type="search" id="q" placeholder="search parts, ideas, briefs, trees" value="${esc(q)}" enterkeyhint="search" aria-label="search"><button class="button">Search</button></form><div id="r" class="muted">…</div>`, 'library');
  primary('');
  byId<HTMLFormElement>('f').onsubmit = (e) => { e.preventDefault(); void library(byId<HTMLInputElement>('q').value); };
  const r = await api<SearchView>(`/api/search?q=${encodeURIComponent(q)}`);
  byId('r').innerHTML = `
    <h2>Ideas (${r.snowmobiles.length})</h2><div class="list">${r.snowmobiles.map((s) => `<a href="${s.status === 'graveyard' ? `#/hunt/${s.hunt_id}/graveyard` : `#/grill/${s.id}`}">
      <span class="tag">${MARK[s.status] || ''} ${esc(s.status)}</span><b>${esc(s.name)}</b> <span class="small muted">${esc(s.pitch)} · seed: ${esc(s.seed)}</span></a>`).join('')}</div>
    <h2>Parts (${r.components.length})</h2><div class="list">${r.components.map((c) => `<div><span class="chip ${c.bad_reason ? 'bad' : ''}">${link(c.url, c.name)}</span>
      <span class="small muted">${esc(c.source)} · ${esc(c.mechanism)}</span> <a class="button btn ghost" href="#/hunt/${c.hunt_id}/parts">hunt</a></div>`).join('')}</div>
    <h2>Hunts (${r.hunts.length})</h2><div class="list">${r.hunts.map((h) => `<a href="#/hunt/${h.id}"><b>${esc(h.seed)}</b></a>`).join('')}</div>`;
}

async function route(): Promise<void> {
  view++;
  lastTree = null; lastMap = null;
  clearTimeout(timer);
  const [, page, id = '', tab] = location.hash.split('/');
  try {
    if (page === 'hunt') await hunt(id, tab);
    else if (page === 'stack') await stack();
    else if (page === 'grill') await grill(id);
    else if (page === 'library') await library();
    else await home();
  } catch (e) { shell(`<p class="err">${esc((e as Error).message)}</p>`); primary(''); }
}

window.addEventListener('resize', () => {
  if (lastTree) drawEdges(lastTree);
  const box = document.getElementById('map');
  if (lastMap && box && Number(box.dataset.w) !== box.clientWidth) drawMap(lastMap.s, lastMap.byId);
});
window.addEventListener('hashchange', () => void route());
void route();

// Test hook: the browser test reads the toast countdown through this object.
Object.assign(window, { __snowmobile: { countdown, toast, toastEl, clock: () => toastClock, setClock: (c: Countdown | null) => { toastClock = c; } } });
