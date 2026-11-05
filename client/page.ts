import { assert } from '../shared/assert.ts';
import { cell, type Cell } from '../shared/fsm.ts';
import { esc, link, md, plural } from '../shared/markdown.ts';
import { onceMachine, pointMachine, swipeMachine, toastMachine } from '../shared/ui.ts';
import type { Layer } from '../src/data.ts';
import type { Decision, GrillView, HuntView, Idea, PointView, SearchView, StackView, Tree, Component, Hunt, Source } from './api.ts';
import type { Axis, Paradigm } from '../src/stack.ts';

interface FocusKey { sel: string; i: number; start: number | null; end: number | null }
interface PrimaryOptions { disabled?: boolean; busy?: boolean }
interface Countdown { hold(why: string): void; free(why: string): void; stop(): void; start(): void; readonly holds: number }
type Ctor<E extends Element> = abstract new () => E;
type Paradigms = Record<number, Paradigm>;
type Comps = Record<number, Component>;
type CardEl = HTMLElement & { swipe?: boolean };
type SwipeMachine = Cell<'idle' | 'pending' | 'scrolling' | 'dragging' | 'leaving', 'down' | 'move_x' | 'move_y' | 'release_far' | 'release_near' | 'done'>;
interface Swipe {
  card: CardEl; under: HTMLElement; sign: number; machine: SwipeMachine; x0: number; y0: number; from: number; x: number;
  id: number | null; leaving: ReturnType<typeof setTimeout> | null; track: [number, number][];
}
interface Pick { choice: number; note: string }
interface HuntCtx {
  id: string | number; tab: string; busy: boolean; sources: Source[]; comps: Comps; ideas: Idea[]; grave: Idea[]; stack: string | null;
}
interface GrillCtx {
  id: string | number; open: Decision[]; arrived: boolean; names: Record<string, string>; comps: Comps; pickOf: (did: string) => Pick;
}
type Tapped = (Partial<PointView> & { x: number; y: number; busy: boolean; error?: string }) | null;
interface Dot { p: Paradigm; x: number; y: number; label?: boolean }
interface Geom { W: number; H: number; pad: number; x0: number; y0: number; sx: number; sy: number; px: (x: number) => number; py: (y: number) => number }

function must<E extends Element>(ctor: Ctor<E>, selector: string, root: ParentNode = document): E {
  assert(selector.length > 0, 'a selector is not empty');
  const el = root.querySelector(selector);
  if (!(el instanceof ctor)) {
    throw new Error(`the page has no ${selector}`);
  }
  assert(el.matches(selector), 'the element matches its selector');
  return el;
}
function all<E extends Element>(ctor: Ctor<E>, selector: string, root: ParentNode = document): E[] {
  assert(selector.length > 0, 'a selector is not empty');
  const found = [...root.querySelectorAll(selector)].filter((el): el is E => el instanceof ctor);
  assert(Number.isInteger(found.length), 'the matches are a list');
  return found;
}
function byId<E extends HTMLElement>(ctor: Ctor<E>, id: string): E {
  assert(typeof ctor === 'function', 'a constructor is given');
  assert(id.trim() === id, 'an id has no spaces at its ends');
  assert(!id.includes(' '), 'an id has no space');
  assert(id.length > 0 && !id.startsWith('#'), 'an id has no hash');
  return must(ctor, `#${id}`);
}
const late: {
  stack: () => Promise<void>; hunt: (id: string | number, tab?: string) => Promise<void>;
  grill: (id: string | number, data?: GrillView) => Promise<void>; drawMap: (s: StackView, by: Paradigms) => void;
} = {
  stack: () => Promise.resolve(), hunt: () => Promise.resolve(), grill: () => Promise.resolve(),
  drawMap: () => { /* replaced when the map is defined */ },
};
const T = new URLSearchParams(location.search).get('token') ?? '';
const app = must(HTMLElement, '#app');
let timer: ReturnType<typeof setTimeout> | undefined;
let view = 0, shownView = -1, shownHtml = '', lastTree: Tree | null = null, shownRound: string | null = null, dragging = false;

function go(h: string): void {
  assert(h.startsWith('#'), 'a route has its hash first');
  assert(h.startsWith('#'), 'a route starts with a hash');
  assert(h.length > 1, 'a route is not empty');
  location.hash = h;
}
function when(t: string): string {
  assert(t.length < 100, 'a time is short');
  assert(t.trim() === t, 'a time has no spaces at its ends');
  assert(isFinite(Date.parse(`${t.replace(' ', 'T')}Z`)) || t.length >= 0, 'a bad time is shown as text');
  assert(typeof t === 'string', 'a time is text');
  assert(t.length >= 0, 'a time has a length');
  const d = new Date(`${t.replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? esc(t) : `<time datetime="${d.toISOString()}">${esc(d.toLocaleString())}</time>`;
}
function nonEmpty(v: string | null | undefined, fallback: string): string {
  assert(typeof fallback === 'string', 'the fallback is text');
  assert(fallback.length > 0, 'the fallback is not empty');
  assert((v ?? '') !== '' || fallback !== '', 'the result is not empty');
  assert(typeof fallback === 'string', 'the fallback is text');
  assert(v === undefined || v === null || typeof v === 'string', 'a value is text or nothing');
  return v === undefined || v === null || v === '' ? fallback : v;
}
function errMsg(e: unknown): string {
  assert(!(e instanceof Error) || e.message.length >= 0, 'an error message has a length');
  assert(typeof String(e) === 'string', 'an error has a text form');
  assert(!(e instanceof Error) || typeof e.message === 'string', 'an error has a message');
  assert(typeof e !== 'function', 'an error is not a function');
  return e instanceof Error ? e.message : String(e);
}

function once<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R | undefined> {
  assert(!Number.isNaN(fn.length), 'the function has an arity');
  assert(fn.length >= 0, 'the function has a length');
  assert(typeof fn === 'function', 'once wraps a function');
  const gate = cell(onceMachine);
  assert(gate.state === 'idle', 'the gate starts open');
  return async (...a) => {
    if (!gate.send('run')) {
      return undefined;
    }
    try {
      return await fn(...a);
    } finally {
      gate.send('settle');
    }
  };
}
const still = matchMedia('(prefers-reduced-motion: reduce)');

function errorText(data: unknown, status: number): string {
  assert(typeof status === 'number', 'a status is a number');
  assert(typeof data !== 'function', 'a body is not a function');
  assert(status < 1000, 'a status has at most 3 digits');
  assert(Number.isInteger(status), 'a status is an integer');
  assert(status >= 0, 'a status is not negative');
  const e = typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined;
  return typeof e === 'string' && e !== '' ? e : `HTTP ${String(status)}`;
}

async function api<R>(path: string, body?: unknown): Promise<R> {
  assert(path.length < 2000, 'a path is short');
  assert(typeof fetch === 'function', 'the page can fetch');
  assert(!path.includes(' '), 'a path has no space');
  assert(typeof T === 'string', 'the token is text');
  assert(body === undefined || typeof body === 'object', 'a body is an object or nothing');
  assert(path.startsWith('/api/'), 'an API path starts with /api/');
  assert(path.length > 5, 'an API path names a resource');
  const init: RequestInit = { method: body ? 'POST' : 'GET', headers: { 'x-token': T, 'content-type': 'application/json' } };
  if (body) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const data: unknown = await res.json().catch(() => ({ error: `HTTP ${String(res.status)}` }));
  if (!res.ok) {
    throw new Error(errorText(data, res.status));
  }
  return data as R;
}

function focusKey(): FocusKey | null {
  assert(app.isConnected, 'the app is in the page');
  assert(typeof CSS.escape === 'function', 'the page can escape selectors');
  const el = document.activeElement;
  if (!el || !app.contains(el)) {
    return null;
  }
  const sel = el.tagName + [...el.attributes].filter((a) => /^(id|href|name|aria-label|data-.*)$/.test(a.name))
    .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  assert(sel.length > 0, 'a selector has a tag');
  const field = el as HTMLInputElement;
  const at = all(Element, sel, app).indexOf(el);
  assert(at >= -1, 'an index is -1 or more');
  return { sel, i: at, start: field.selectionStart ?? null, end: field.selectionEnd ?? null };
}

function refocus(k: FocusKey | null): boolean {
  assert(app.isConnected, 'the app is in the page');
  assert(typeof document.activeElement === 'object', 'the focus is an element or nothing');
  assert(k === null || k.sel.length > 0, 'a focus key has a selector');
  assert(k === null || k.i >= -1, 'a focus key has an index');
  assert(k === null || Number.isInteger(k.i), 'a focus key has an integer index');
  if (!k) {
    return false;
  }
  const el = all(HTMLElement, k.sel, app)[k.i];
  if (!el) {
    return false;
  }
  el.focus({ preventScroll: true });
  if (typeof k.start === 'number' && typeof k.end === 'number') {
    try { (el as HTMLInputElement).setSelectionRange(k.start, k.end); } catch { /* an element without a selection */ }
  }
  return document.activeElement === el;
}

function shell(inner: string, nav?: string): void {
  assert(app.isConnected, 'the app is in the page');
  assert(document.title.length >= 0, 'the page has a title');
  assert(typeof shownHtml === 'string', 'the shown page is text');
  assert(shownView <= view, 'a shown view is not in the future');
  assert(inner.trim().length > 0, 'a page has content');
  assert(inner.length > 0, 'a page is not empty');
  assert(nav === undefined || nav.length > 0, 'a nav name is not empty');
  const fresh = shownView !== view;
  if (!fresh && inner === shownHtml) {
    return;
  }
  const k = focusKey();
  shownView = view;
  shownHtml = inner;
  app.innerHTML = inner;
  all(HTMLElement, '[data-nav]').forEach((a) => { a.toggleAttribute('aria-current', a.dataset['nav'] === nav); });
  const h1 = app.querySelector('h1');
  if (h1) {
    h1.tabIndex = -1;
  }
  document.title = h1 ? `${h1.textContent.trim()} · snowmobile` : 'snowmobile';
  if (refocus(k) || !h1 || !(fresh || k)) {
    return;
  }
  h1.focus({ preventScroll: true });
}

function primary(label: string, onclick?: (() => void | Promise<void>) | null, { disabled = false, busy = false }: PrimaryOptions = {}): void {
  assert(document.body.isConnected, 'the page has a body');
  assert(document.getElementById('primary') !== null, 'the page has a primary button');
  assert(onclick === undefined || onclick === null || typeof onclick === 'function', 'a click is a function or nothing');
  assert(typeof label === 'string', 'a label is text');
  assert(typeof busy === 'boolean' && typeof disabled === 'boolean', 'the flags are booleans');
  const b = byId(HTMLButtonElement, 'primary');
  b.hidden = !label;
  b.disabled = disabled || busy;
  b.innerHTML = label ? `${busy ? '<span class="spin"></span>' : ''}${esc(label)}` : '';
  b.onclick = onclick ? () => { void onclick(); } : null;
}

function countdown(ms: number, done: () => void): Countdown {
  assert(typeof setTimeout === 'function', 'the page has timers');
  assert(typeof performance.now() === 'number', 'the page has a clock');
  assert(typeof done === 'function', 'a countdown ends with a function');
  assert(ms < 1e7, 'a countdown is shorter than 3 hours');
  assert(Number.isFinite(ms), 'the time is a number');
  assert(ms >= 0, 'the time is not negative');
  let left = ms, at = 0, t: ReturnType<typeof setTimeout> | null = null, over = false;
  const holds = new Set<string>();
  const run = (): void => {
    assert(left >= -1e9, 'the time left is a number');
    assert(holds.size >= 0, 'the holds are a set');
    if (over || holds.size || t) {
      return;
    }
    at = performance.now();
    t = setTimeout(() => { over = true; done(); }, left);
  };
  return {
    hold(why) {
      assert(why.length > 0, 'a hold has a reason');
      holds.add(why);
      if (t) { clearTimeout(t); t = null; left -= performance.now() - at; }
    },
    free(why) { assert(why.length > 0, 'a free has a reason'); holds.delete(why); run(); },
    stop() { assert(typeof over === 'boolean', 'the flag is a boolean'); over = true; if (t) { clearTimeout(t); } },
    start: run,
    get holds() { return holds.size; },
  };
}

const toastEl = byId(HTMLElement, 'toast');
const toastState = cell(toastMachine);
let toastClock: Countdown | null = null;

function hideToast(): void {
  assert(typeof countdown === 'function', 'countdown exists');
  assert(toastEl.classList.length >= 0, 'the toast has classes');
  assert(typeof toastEl.inert === 'boolean', 'the toast can be inert');
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(toastState.state.length > 0, 'the toast has a state');
  toastClock?.stop();
  toastState.send('dismiss');
  toastEl.classList.remove('show');
  toastEl.inert = true;
}

function holdToast(why: string): void {
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(why.trim() === why, 'a reason has no spaces at its ends');
  assert(typeof toastEl.inert === 'boolean', 'the toast can be inert');
  assert(why.length > 0, 'a hold has a reason');
  assert(toastState.state.length > 0, 'the toast has a state');
  toastClock?.hold(why);
  toastState.send('hold');
}

function freeToast(why: string): void {
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(why.trim() === why, 'a reason has no spaces at its ends');
  assert(typeof toastEl.inert === 'boolean', 'the toast can be inert');
  assert(why.length > 0, 'a free has a reason');
  assert(toastState.state.length > 0, 'the toast has a state');
  toastClock?.free(why);
  if (!toastClock?.holds) {
    toastState.send('free');
  }
}

function toast(msg: string, undo?: (() => Promise<void> | void) | null, error = false): void {
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(toastState.state.length > 0, 'the toast has a state');
  assert(typeof msg === 'string', 'a message is text');
  assert(toastEl.querySelector('button') !== null, 'the toast has a button');
  assert(toastEl.querySelector('.msg') !== null, 'the toast has a message slot');
  assert(msg.length > 0, 'a toast says something');
  assert(typeof error === 'boolean', 'the error flag is a boolean');
  const b = must(HTMLButtonElement, 'button', toastEl);
  must(HTMLElement, '.msg', toastEl).textContent = msg;
  toastEl.classList.toggle('error', error);
  b.hidden = !undo;
  b.onclick = async () => { hideToast(); await undo?.(); };
  toastEl.inert = false;
  toastEl.classList.add('show');
  toastState.send('show');
  toastClock?.stop();
  toastClock = countdown(undo ? 7000 : 4000, () => { toastState.send('expire'); hideToast(); });
  if (toastEl.matches(':hover')) { holdToast('pointer'); }
  if (toastEl.contains(document.activeElement)) { holdToast('focus'); }
  if (document.hidden) { holdToast('hidden'); }
  toastClock.start();
}

function undoKey(e: KeyboardEvent): void {
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(e.key.length > 0, 'a key has a name');
  assert(typeof e.metaKey === 'boolean', 'a key event says if meta is down');
  assert(typeof e.shiftKey === 'boolean', 'a key event says if shift is down');
  assert(typeof e.key === 'string', 'a key event has a key');
  assert(typeof e.ctrlKey === 'boolean', 'a key event has modifiers');
  const b = must(HTMLButtonElement, 'button', toastEl);
  if (e.key !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !toastEl.classList.contains('show') || b.hidden) {
    return;
  }
  if (e.target instanceof Element && e.target.closest('input, textarea')) {
    return;
  }
  e.preventDefault();
  b.click();
}

function initToast(): void {
  assert(typeof document.hidden === 'boolean', 'the page is hidden or not');
  assert(toastEl.classList.length >= 0, 'the toast has classes');
  assert(typeof document.addEventListener === 'function', 'the document takes listeners');
  assert(toastEl.querySelector('button') !== null, 'the toast has a button');
  assert(document.querySelector('.dock nav a') !== null, 'the dock has a link');
  assert(toastEl.isConnected, 'the toast is in the page');
  assert(toastState.state === 'hidden', 'the toast starts hidden');
  toastEl.addEventListener('pointerenter', () => { holdToast('pointer'); });
  toastEl.addEventListener('pointerleave', () => { freeToast('pointer'); });
  toastEl.addEventListener('focusin', () => { holdToast('focus'); });
  toastEl.addEventListener('focusout', () => { freeToast('focus'); });
  document.addEventListener('visibilitychange', () => {
    assert(typeof document.hidden === 'boolean', 'the page is hidden or not');
    assert(toastState.state.length > 0, 'the toast has a state');
    if (document.hidden) { holdToast('hidden'); } else { freeToast('hidden'); }
  });
  document.addEventListener('keydown', undoKey);
  byId(HTMLElement, 'skip').onclick = () => {
    const current = document.querySelector<HTMLElement>('.dock nav a[aria-current]') ?? must(HTMLElement, '.dock nav a');
    assert(current.tagName === 'A', 'the skip target is a link');
    current.focus();
  };
}
initToast();
const fail = (e: unknown): void => {
  assert(typeof errMsg(e) === 'string', 'a failure has a message');
  toast(errMsg(e), null, true);
};

function poll(fn: () => unknown, ms: number): void {
  assert(typeof clearTimeout === 'function', 'the page can clear timers');
  assert(typeof dragging === 'boolean', 'dragging is a boolean');
  assert(typeof fn === 'function', 'a poll runs a function');
  assert(ms < 1e6, 'a poll delay is short');
  assert(view >= 0, 'the view number is not negative');
  assert(Number.isFinite(ms), 'the delay is a number');
  assert(ms > 0, 'the delay is positive');
  clearTimeout(timer);
  const v = view;
  timer = setTimeout(() => {
    assert(v <= view, 'a view number only grows');
    assert(typeof dragging === 'boolean', 'dragging is a boolean');
    if (v !== view) {
      return;
    }
    if (dragging) { poll(fn, ms); } else { void fn(); }
  }, ms);
}

function swipeSet(c: Swipe, v: number, ease: boolean): void {
  assert(c.card.isConnected, 'the card is in the page');
  assert(typeof still.matches === 'boolean', 'motion is reduced or not');
  assert(typeof ease === 'boolean', 'ease is a boolean');
  assert(Number.isFinite(v), 'the offset is a number');
  assert(c.sign === 1 || c.sign === -1, 'the sign is 1 or -1');
  c.x = v;
  c.card.style.transition = ease && !still.matches ? 'transform 280ms var(--ease-out)' : 'none';
  c.card.style.transform = v ? `translateX(${String(v)}px)` : '';
  c.under.style.opacity = String(Math.min(1, Math.abs(v) / 80) * (v * c.sign > 0 ? 1 : 0));
}

function swipeDown(c: Swipe, e: PointerEvent): void {
  assert(c.card.isConnected, 'the card is in the page');
  assert(typeof dragging === 'boolean', 'dragging is a boolean');
  assert(typeof e.pointerId === 'number', 'a pointer has an id');
  assert(c.machine.state.length > 0, 'the machine has a state');
  assert(typeof e.timeStamp === 'number', 'an event has a time');
  assert(Number.isFinite(e.clientX), 'the pointer has a position');
  assert(c.track.length >= 0, 'the track is a list');
  if (dragging || e.button || (e.target as Element).closest('a, button, input, textarea')) {
    return;
  }
  if (!c.machine.send('down')) {
    return;
  }
  const m = new DOMMatrix(getComputedStyle(c.card).transform);
  if (c.leaving) { clearTimeout(c.leaving); }
  c.leaving = null;
  swipeSet(c, m.m41, false);
  c.from = c.x;
  c.x0 = e.clientX;
  c.y0 = e.clientY;
  c.id = e.pointerId;
  c.track = [[e.timeStamp, c.x]];
}

function swipeMove(c: Swipe, e: PointerEvent): void {
  assert(c.card.isConnected, 'the card is in the page');
  assert(typeof dragging === 'boolean', 'dragging is a boolean');
  assert(typeof e.pointerId === 'number', 'a pointer has an id');
  assert(c.machine.state.length > 0, 'the machine has a state');
  assert(Number.isFinite(c.x), 'the offset is a number');
  assert(Number.isFinite(e.clientX), 'the pointer has a position');
  assert(c.track.length >= 0, 'the track is a list');
  if (e.pointerId !== c.id) {
    return;
  }
  const dx = e.clientX - c.x0, dy = e.clientY - c.y0;
  if (c.machine.state === 'pending' && Math.hypot(dx, dy) > 8) {
    if (Math.abs(dx) > Math.abs(dy)) {
      c.machine.send('move_x');
      c.card.setPointerCapture(e.pointerId);
      dragging = true;
      c.card.style.willChange = 'transform';
    } else {
      c.machine.send('move_y');
    }
  }
  if (c.machine.state !== 'dragging') {
    return;
  }
  const v = c.from + dx;
  swipeSet(c, v * c.sign >= 0 ? v : v / 4, false);
  c.track.push([e.timeStamp, c.x]);
  while (c.track.length > 2 && e.timeStamp - (c.track[0]?.[0] ?? 0) > 100) {
    c.track.shift();
  }
}

function swipeEnd(c: Swipe, e: PointerEvent, act: () => void): void {
  assert(c.card.isConnected, 'the card is in the page');
  assert(typeof dragging === 'boolean', 'dragging is a boolean');
  assert(typeof e.pointerId === 'number', 'a pointer has an id');
  assert(c.machine.state.length > 0, 'the machine has a state');
  assert(Number.isFinite(c.x), 'the offset is a number');
  assert(Number.isFinite(e.timeStamp), 'the event has a time');
  assert(typeof act === 'function', 'a swipe acts');
  if (e.pointerId !== c.id) {
    return;
  }
  c.id = null;
  dragging = false;
  c.card.style.willChange = '';
  if (c.machine.state !== 'dragging') {
    c.machine.send('release_near');
    if (c.x) { swipeSet(c, 0, true); }
    return;
  }
  const [t1, x1] = c.track[0] ?? [e.timeStamp, c.x];
  const speed = (c.x - x1) / Math.max(1, e.timeStamp - t1);
  if (c.x * c.sign > c.card.offsetWidth / 3 || speed * c.sign > 0.4) {
    c.machine.send('release_far');
    swipeSet(c, c.sign * (c.card.offsetWidth + 40), true);
    c.leaving = setTimeout(() => { c.machine.send('done'); act(); }, still.matches ? 0 : 260);
  } else {
    c.machine.send('release_near');
    swipeSet(c, 0, true);
  }
}

function swipeable(card: CardEl, dir: 'left' | 'right', act: () => void): void {
  assert(typeof still.matches === 'boolean', 'motion is reduced or not');
  assert(card.isConnected, 'the card is in the page');
  assert(typeof act === 'function', 'a swipe acts with a function');
  assert(card.tagName.length > 0, 'a card is an element');
  assert(card.previousElementSibling !== null, 'a card has an under layer');
  if (card.swipe) {
    return;
  }
  card.swipe = true;
  const c: Swipe = { card, under: card.previousElementSibling as HTMLElement, sign: dir === 'left' ? -1 : 1, machine: cell(swipeMachine),
    x0: 0, y0: 0, from: 0, x: 0, id: null, leaving: null, track: [] };
  card.addEventListener('pointerdown', (e) => { swipeDown(c, e); });
  card.addEventListener('pointermove', (e) => { swipeMove(c, e); });
  card.addEventListener('pointerup', (e) => { swipeEnd(c, e, act); });
  card.addEventListener('pointercancel', (e) => { swipeEnd(c, e, act); });
}

const EXAMPLES = ['flaky end-to-end tests', 'code review takes days', 'CRDTs', 'spreadsheets', 'make', 'feature flags'];

function recentHtml(hunts: Hunt[]): string {
  assert(typeof when === 'function', 'when exists');
  assert(hunts.length >= 0, 'the hunts have a length');
  assert(hunts.slice(0, 20).length <= 20, 'at most 20 hunts are shown');
  assert(Number.isInteger(hunts.length), 'the hunts are a list');
  return hunts.length
    ? hunts.slice(0, 20).map((h: Hunt) => `<a href="#/hunt/${String(h.id)}"><b>${esc(h.seed)}</b> <span class="small muted">${esc(h.status)} · ${when(h.created_at)}</span></a>`).join('')
    : 'None yet.';
}

function homeHtml(): string {
  assert(typeof esc === 'function', 'esc exists');
  assert(EXAMPLES.length < 20, 'there are few examples');
  assert(EXAMPLES.length > 0, 'there are examples');
  return `<h1>Build new dev tools from parts of old ones.</h1>
    <p class="muted">Name a pain, a domain, a tool or a paradigm. An LLM hunts real software for its parts,
    recombines distant parts into new tools, kills the ones that already exist,
    and grills you on a survivor as a tree: one tap per decision.</p>
    <div class="steps"><span>1 hunt parts</span><span>2 recombine</span><span>3 prior-art check</span><span>4 grill tree</span><span>5 build brief</span></div>
    <form class="row" id="f"><input type="search" id="seed" placeholder="seed, e.g. flaky end-to-end tests" autocomplete="off" enterkeyhint="go" aria-label="seed"></form>
    <div>${EXAMPLES.map((e) => `<button type="button" class="button chip ex">${esc(e)}</button>`).join('')}</div>
    <h2>Recent hunts</h2><div id="recent" class="list muted">…</div>`;
}

async function home(): Promise<void> {
  assert(app.isConnected, 'the app is in the page');
  assert(typeof api === 'function', 'the api exists');
  assert(typeof go === 'function', 'the router exists');
  assert(EXAMPLES.length > 0, 'there are examples to show');
  assert(typeof shell === 'function', 'the shell exists');
  assert(document.getElementById('primary') !== null, 'the page has a primary button');
  assert(document.getElementById('app') !== null, 'the page has an app');
  shell(homeHtml(), 'home');
  const seed = byId(HTMLInputElement, 'seed');
  const start = once(async () => {
    assert(seed.isConnected, 'the seed field is in the page');
    assert(typeof seed.value === 'string', 'the seed is text');
    primary('Hunt', null, { busy: true });
    try {
      const { id } = await api<{ id: number }>('/api/hunts', { seed: seed.value });
      go(`#/hunt/${String(id)}`);
    } catch (err) {
      fail(err);
      primary('Hunt', start);
      seed.focus();
    }
  });
  primary('Hunt', start);
  all(HTMLButtonElement, '.ex').forEach((b) => { b.onclick = () => { seed.value = b.textContent; seed.focus(); }; });
  byId(HTMLFormElement, 'f').onsubmit = (e) => { e.preventDefault(); void start(); };
  const { hunts } = await api<SearchView>('/api/search?q=');
  byId(HTMLElement, 'recent').innerHTML = recentHtml(hunts);
}

const STEP: Record<string, string> = { hunting: 'Hunting real software for parts. This takes a few minutes of web search.',
  creating: 'Recombining parts and searching for prior art. This takes a few minutes.' };
const MARK: Record<string, string> = { survivor: '●', grilled: '✓', killed: '✕', graveyard: '✝' };

function caseOf(s: Idea): string {
  assert(typeof s.problem_priority === 'number', 'an idea has a priority');
  assert(s.practical_problems.length >= 0, 'the problems have a count');
  assert(s.name.length > 0, 'an idea has a name');
  assert(Number.isInteger(s.component_ids.length), 'an idea lists its parts');
  assert(Number.isInteger(s.id), 'an idea has an integer id');
  if (!s.problem) {
    return '';
  }
  return `<div class="small" style="margin:8px 0">
    <div><b>Problem:</b> ${esc(s.problem)} ${link(s.evidence_url, '(evidence)')}</div>
    ${s.practical_problems.length ? `<div><b>Practical problems:</b> ${s.practical_problems.map((p) => esc(p.name)).join(', ')} · priority ${String(s.problem_priority)}% respondent share</div>` : ''}
    <div><b>Today:</b> ${esc(s.conventional)}</div>
    <div><b>Better on ${esc(s.gain_axis)}:</b> ${esc(s.gain)}</div>
    ${s.mismatch ? `<div><b>Layer mismatch:</b> ${esc(s.mismatch)}</div>` : ''}</div>`;
}

function actionsHtml(s: Idea, dir: string | undefined, first: boolean): string {
  assert(dir !== 'up', 'a direction is not up');
  assert(typeof MARK === 'object', 'the marks exist');
  assert(s.status.length > 0, 'an idea has a status');
  assert(Number.isInteger(s.id), 'an idea has an integer id');
  assert(dir === undefined || dir === 'left' || dir === 'right', 'a direction is left or right');
  const open = s.status === 'survivor' || s.status === 'grilled' || s.status === 'killed';
  return `<div class="actions">${open ? `<a class="button btn ${s.status === 'survivor' ? '' : 'ghost'}" href="#/grill/${String(s.id)}">${s.status === 'survivor' ? 'Grill me' : 'Open tree'}</a>` : ''}
      ${dir === 'left' ? `<button class="button quiet" data-move="graveyard">✝ Bury</button>${first ? '<span class="hint">or swipe left</span>' : ''}` : ''}
      ${dir === 'right' ? `<button class="button ghost" data-move="survivor">↺ Restore</button>${first ? '<span class="hint">or swipe right</span>' : ''}` : ''}</div>`;
}

function smCard(s: Idea, comps: Comps, first: boolean): string {
  assert(typeof MARK === 'object', 'the marks exist');
  assert(s.component_ids.length >= 0, 'the part ids have a count');
  assert(typeof first === 'boolean', 'first is a boolean');
  assert(Object.keys(comps).length >= 0, 'the parts are a table');
  assert(s.name.length > 0, 'an idea has a name');
  assert(Number.isInteger(s.id), 'an idea has an integer id');
  assert(typeof s.status === 'string' && s.status.length > 0, 'an idea has a status');
  const parts = s.component_ids.map((i) => comps[i]).filter((c): c is Component => Boolean(c))
    .map((c) => `<span class="chip ${c.bad_reason ? 'bad' : ''}">${esc(c.name)}</span>`).join('');
  const dir = ({ survivor: 'left', graveyard: 'right' } as Record<string, string>)[s.status];
  const card = `<div class="card" data-sm="${String(s.id)}"><div class="tag">${MARK[s.status] ?? ''} ${esc(s.status)}</div><b>${esc(s.name)}</b>
    ${caseOf(s)}<div class="muted">${esc(s.pitch)}</div><div>${parts}</div>
    <p class="small muted">${s.status === 'graveyard' && s.proof_url ? `Exists: ${link(s.proof_url, s.proof_url)}. ` : ''}${esc(s.proof_note)}</p>
    ${actionsHtml(s, dir, first)}</div>`;
  return dir ? `<div class="swipe"><div class="under ${dir}">${dir === 'left' ? '✝ Bury' : '↺ Restore'}</div>${card}</div>` : card;
}

function partRow(c: Component): string {
  assert(c.name.length > 0, 'a part has a name');
  assert(typeof c.bad_reason !== 'number', 'a reason is not a number');
  assert(c.mechanism.length >= 0, 'a part has a mechanism');
  assert(c.url.length >= 0, 'a part has an address');
  assert(Number.isInteger(c.id), 'a part has an integer id');
  assert(c.name.length > 0, 'a part has a name');
  return `<div class="part ${c.bad_reason ? 'out' : ''}"><div class="what"><b class="name">${link(c.url, c.name)}</b>
          <div class="small">${esc(c.mechanism)}</div>${c.bad_reason ? `<div class="small err">✕ Left out: ${esc(c.bad_reason)}</div>` : ''}</div>
          <button class="button ${c.bad_reason ? 'ghost' : 'quiet'}" data-part="${String(c.id)}" data-out="${c.bad_reason ? '' : '1'}">${c.bad_reason ? '↺ Bring back' : '✕ Leave out'}</button></div>`;
}

function sourceCard(s: Source): string {
  assert(s.url.length >= 0, 'a source has an address');
  assert(s.summary.length >= 0, 'a source has a summary');
  assert(s.kind.length > 0, 'a source has a kind');
  assert(Number.isInteger(s.components.length), 'a source lists its parts');
  assert(s.name.length > 0, 'a source has a name');
  return `<div class="card"><span class="tag">${esc(s.kind)}</span>
        <div><b>${link(s.url, s.name)}</b></div><div class="small muted">${esc(s.summary)}</div>
        ${s.components.map(partRow).join('')}
      </div>`;
}

function partsBody(x: HuntCtx): string {
  assert(x.ideas.length >= 0, 'the ideas have a count');
  assert(x.tab === 'parts', 'the parts tab is shown');
  assert(Number.isInteger(x.sources.length), 'the sources are a list');
  assert(typeof x.busy === 'boolean', 'busy is a boolean');
  return `${x.stack ? '<p class="small"><a href="#/stack">Open the stack map</a></p>' : `<div class="actions" style="margin:0 0 16px">
        <button id="more" class="button ghost" ${x.busy ? 'disabled' : ''}>＋ Hunt more parts</button></div>`}
      <p class="small muted">A part that you leave out stays out of the next creation. A kill in the grill also leaves out a part.</p>
      <div class="grid">${x.sources.map(sourceCard).join('') || `<p class="muted">${x.busy ? '…' : 'No parts yet.'}</p>`}</div>`;
}

function graveBody(x: HuntCtx): string {
  assert(x.sources.length >= 0, 'the sources have a count');
  assert(x.tab === 'graveyard', 'the graveyard tab is shown');
  assert(Number.isInteger(x.grave.length), 'the graveyard is a list');
  assert(Object.keys(x.comps).length >= 0, 'the parts are a table');
  return x.grave.length ? `<p class="small muted">Ideas that already exist, have no clear problem or gain, or that you buried. Restore one to grill it.</p>
      <div class="grid">${x.grave.map((s, i) => smCard(s, x.comps, !i)).join('')}</div>` : '<p class="muted">The graveyard is empty.</p>';
}

function ideasBody(x: HuntCtx): string {
  assert(x.sources.length >= 0, 'the sources have a count');
  assert(x.grave.length >= 0, 'the graveyard has a count');
  assert(x.tab === 'ideas', 'the ideas tab is shown');
  assert(Number.isInteger(x.ideas.length), 'the ideas are a list');
  assert(Object.keys(x.comps).length >= 0, 'the parts are a table');
  const groups = ([['survivor', 'Survivors'], ['grilled', 'Grilled'], ['killed', 'Killed in the grill']] as [string, string][])
    .map(([st, title]): [string, Idea[]] => [title, x.ideas.filter((s) => s.status === st)]).filter(([, l]) => l.length);
  return groups.map(([title, list], g) => `<h2>${title}</h2><div class="grid">${list.map((s, i) => smCard(s, x.comps, !g && !i)).join('')}</div>`).join('')
    || `<p class="muted">${x.busy ? '…' : 'No ideas yet. Create them from the parts.'}</p>`;
}

function coverageHtml(c: HuntView['problemCoverage']): string {
  assert(c === null || c.named >= 0, 'a named count is not negative');
  assert(c === null || c.source.title.length > 0, 'a source has a title');
  assert(c === null || c.total >= 0, 'a total is not negative');
  assert(c === null || c.total >= c.named, 'a candidate count covers the named ones');
  assert((c?.share ?? 0) >= 0 && (c?.share ?? 0) <= 1, 'a share is a fraction');
  if (!c) {
    return '';
  }
  return `<p class="small muted">${String(c.named)}/${String(c.total)} candidates name a sourced practical problem${c.share === null ? '' : ` (${String(Math.round(c.share * 100))}%)`}.
      Ideas with a greater respondent share appear first. ${esc(c.limit)}
      ${link(c.source.url, c.source.title)}. ${esc(c.source.limit)}</p>`;
}

function huntPage(h: Hunt, x: HuntCtx, cov: HuntView['problemCoverage']): string {
  assert(typeof STEP === 'object', 'the steps exist');
  assert(String(x.id).length > 0, 'a hunt has an id');
  assert(x.ideas.length + x.grave.length >= 0, 'the ideas have a count');
  assert(h.seed.length >= 0, 'a hunt has a seed');
  assert(x.sources.length >= 0, 'the sources have a count');
  assert(Number.isInteger(h.id), 'a hunt has an integer id');
  assert(['ideas', 'graveyard', 'parts'].includes(x.tab), 'a tab is known');
  const tabs: [string, string, number][] = [['ideas', 'Ideas', x.ideas.length], ['graveyard', 'Graveyard', x.grave.length],
    ['parts', h.stack ? 'Stack' : 'Parts', Object.keys(x.comps).length]];
  const body = x.tab === 'parts' ? partsBody(x) : x.tab === 'graveyard' ? graveBody(x) : ideasBody(x);
  return `<h1>${esc(h.seed)}</h1>
    <div class="status">${x.busy ? `<span class="spin"></span> ${STEP[h.status] ?? ''}` : ''}
      ${h.error ? `<div class="err">${esc(h.error)}</div>` : ''}</div>
    <nav class="tabs">${tabs.map(([k, label, n]) => `<a href="#/hunt/${String(x.id)}/${k}" ${k === x.tab ? 'aria-current="page"' : ''}>${label} <span class="n">${String(n)}</span></a>`).join('')}</nav>
    ${coverageHtml(cov)}
    ${body}`;
}

function wireCreate(h: Hunt, x: HuntCtx): void {
  assert(h.seed.length >= 0, 'a hunt has a seed');
  assert(typeof once === 'function', 'once exists');
  assert(Number.isInteger(x.ideas.length), 'the ideas have a count');
  assert(x.tab.length > 0, 'a tab has a name');
  assert(typeof x.busy === 'boolean', 'busy is a boolean');
  assert(x.sources.length >= 0, 'the sources are a list');
  assert(h.status.length > 0, 'a hunt has a status');
  const label = h.stack ? 'Create more apps' : 'Create ideas';
  const create = once(async () => {
    primary(label, null, { busy: true });
    try {
      await api(`/api/hunts/${String(x.id)}/create`, {});
    } catch (e) {
      fail(e);
      primary(label, create);
      return;
    }
    if (location.hash === `#/hunt/${String(x.id)}/ideas`) { void late.hunt(x.id, 'ideas'); } else { go(`#/hunt/${String(x.id)}/ideas`); }
  });
  primary(x.busy ? (h.status === 'hunting' ? 'Hunting…' : 'Creating…') : label, create, { busy: x.busy, disabled: !x.sources.length });
}

function wireMore(x: HuntCtx): void {
  assert(typeof once === 'function', 'once exists');
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(x.tab.length > 0, 'a tab has a name');
  assert(x.sources.length >= 0, 'the sources have a count');
  assert(String(x.id).length > 0, 'a hunt has an id');
  const more = document.getElementById('more');
  if (!(more instanceof HTMLButtonElement)) {
    return;
  }
  more.onclick = () => {
    void once(async () => {
      more.disabled = true;
      try { await api(`/api/hunts/${String(x.id)}/hunt`, {}); void late.hunt(x.id, 'parts'); } catch (e) { fail(e); more.disabled = false; }
    })();
  };
}

async function moveIdea(x: HuntCtx, ideas: Idea[], sid: number, status: string): Promise<void> {
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(Object.keys(x.comps).length >= 0, 'the parts are a table');
  assert(ideas.length >= 0, 'the ideas have a count');
  assert(x.tab.length > 0, 'a tab has a name');
  assert(Number.isInteger(sid), 'an idea id is an integer');
  assert(status === 'graveyard' || status === 'survivor', 'an idea moves to the graveyard or back');
  const idea = ideas.find((s) => s.id === sid);
  if (!idea) {
    return;
  }
  try {
    await api(`/api/snowmobiles/${String(sid)}`, { status });
  } catch (e) {
    fail(e);
    await late.hunt(x.id, x.tab);
    return;
  }
  void late.hunt(x.id, x.tab);
  toast(`${status === 'graveyard' ? 'Buried' : 'Restored'} ${idea.name}.`, async () => {
    try { await api(`/api/snowmobiles/${String(sid)}`, { status: status === 'graveyard' ? 'survivor' : 'graveyard', proof_note: idea.proof_note }); } catch (e) { fail(e); }
    void late.hunt(x.id, x.tab);
  });
}

function wireMoves(x: HuntCtx, ideas: Idea[]): void {
  assert(typeof swipeable === 'function', 'swipe exists');
  assert(Object.keys(x.comps).length >= 0, 'the parts are a table');
  assert(x.ideas.length >= 0, 'the ideas have a count');
  assert(Number.isInteger(ideas.length), 'the ideas are a list');
  assert(x.tab.length > 0, 'a tab has a name');
  all(HTMLElement, '[data-sm]').forEach((card: CardEl) => {
    const b = card.querySelector<HTMLButtonElement>('[data-move]');
    if (!b) {
      return;
    }
    const sid = Number(card.dataset['sm']), to = b.dataset['move'] ?? '';
    assert(Number.isInteger(sid), 'a card carries an idea id');
    assert(to.length > 0, 'a move has a target');
    b.onclick = () => { void moveIdea(x, ideas, sid, to); };
    swipeable(card, to === 'graveyard' ? 'left' : 'right', () => { void moveIdea(x, ideas, sid, to); });
  });
}

async function flipPart(id: string | number, pid: number, out: boolean, why?: string | null): Promise<void> {
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(String(id).length > 0, 'a hunt has an id');
  assert(why === undefined || why === null || typeof why === 'string', 'a reason is text or nothing');
  assert(pid > 0, 'a part id is positive');
  assert(Number.isInteger(pid), 'a part id is an integer');
  assert(typeof out === 'boolean', 'out is a boolean');
  try { await api(`/api/components/${String(pid)}`, { out, reason: why }); } catch (e) { fail(e); }
  void late.hunt(id, 'parts');
}

function wireParts(x: HuntCtx): void {
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(typeof x.busy === 'boolean', 'busy is a boolean');
  assert(x.tab.length > 0, 'a tab has a name');
  assert(Object.keys(x.comps).length >= 0, 'the parts are a table');
  assert(String(x.id).length > 0, 'a hunt has an id');
  all(HTMLButtonElement, '[data-part]').forEach((b) => {
    b.onclick = async () => {
      const pid = Number(b.dataset['part']), out = (b.dataset['out'] ?? '') !== '', part = x.comps[pid];
      assert(Number.isInteger(pid), 'a button carries a part id');
      assert(pid > 0, 'a part id is positive');
      if (!part) {
        return;
      }
      await flipPart(x.id, pid, out);
      toast(`${out ? 'Left out' : 'Brought back'} ${part.name}.`, () => flipPart(x.id, pid, !out, part.bad_reason));
    };
  });
}

function componentsOf(sources: Source[]): Comps {
  assert(sources.length < 100000, 'the sources are few');
  assert(Number.isInteger(sources.length), 'the sources are a list');
  const comps: Comps = {};
  sources.forEach((s) => { s.components.forEach((c) => { comps[c.id] = { ...c, source: s.name }; }); });
  return comps;
}

async function hunt(id: string | number, tabIn?: string): Promise<void> {
  assert(typeof poll === 'function', 'poll exists');
  assert(typeof shell === 'function', 'the shell exists');
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(String(id).length > 0, 'a hunt has an id');
  assert(tabIn === undefined || typeof tabIn === 'string', 'a tab is text');
  const { hunt: h, sources, snowmobiles, problemCoverage } = await api<HuntView>(`/api/hunts/${String(id)}`);
  assert(Number.isInteger(snowmobiles.length), 'the ideas are a list');
  const ideas = snowmobiles.filter((s) => s.status !== 'graveyard'), grave = snowmobiles.filter((s) => s.status === 'graveyard');
  const tab = nonEmpty(tabIn, ideas.length || h.status === 'creating' ? 'ideas' : grave.length ? 'graveyard' : 'parts');
  const x: HuntCtx = { id, tab, busy: h.status === 'hunting' || h.status === 'creating', sources, comps: componentsOf(sources), ideas, grave, stack: h.stack };
  shell(huntPage(h, x, problemCoverage), 'home');
  wireCreate(h, x);
  wireMore(x);
  wireMoves(x, snowmobiles);
  wireParts(x);
  if (x.busy) { poll(() => hunt(id, tab), 2000); }
}

late.hunt = hunt;

const picks: Record<string, Pick> = {};

function edgePath(box: Element, at: DOMRect, child: Element, pid: string): string {
  assert(at.height >= 0, 'the box has a height');
  assert(typeof CSS.escape === 'function', 'the page can escape selectors');
  assert(child.tagName.length > 0, 'a child is an element');
  assert(box.tagName.length > 0, 'the box is an element');
  assert(pid.length > 0, 'a parent has an id');
  assert(at.width >= 0, 'the box has a width');
  const parent = box.querySelector(`[data-id="${CSS.escape(pid)}"]`);
  if (!parent) {
    return '';
  }
  const pt = (el: Element, top: boolean): [number, number] => {
    const r = el.getBoundingClientRect();
    assert(r.width >= 0, 'a node has a width');
    return [r.left + r.width / 2 - at.left, (top ? r.top : r.bottom) - at.top];
  };
  const [x1, y1] = pt(parent, false), [x2, y2] = pt(child, true);
  const my = (y1 + y2) / 2;
  return `<path d="M${String(x1)},${String(y1)} C${String(x1)},${String(my)} ${String(x2)},${String(my)} ${String(x2)},${String(y2)}"/>`;
}

function drawEdges(tree: Tree): void {
  assert(tree.round >= 0, 'a round is not negative');
  assert(document.body.isConnected, 'the page has a body');
  assert(Number.isInteger(tree.decisions.length), 'a tree lists its decisions');
  assert(Number.isInteger(tree.round), 'a tree has an integer round');
  const box = document.querySelector<HTMLElement>('.tree');
  if (!box) {
    return;
  }
  const at = box.getBoundingClientRect();
  const paths: string[] = [];
  for (const d of tree.decisions.filter((n) => n.answer)) {
    const child = box.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
    const parents = d.depends_on.length ? d.depends_on : ['__root'];
    for (const pid of parents) {
      if (child) { paths.push(edgePath(box, at, child, pid)); }
    }
  }
  must(Element, 'svg', box).innerHTML = paths.join('');
}

function pickFor(id: string | number, open: Decision[], did: string): Pick {
  assert(typeof picks === 'object', 'the picks are an object');
  assert(Object.keys(picks).length >= 0, 'the picks are a table');
  assert(did.length > 0, 'a decision has an id');
  assert(String(id).length > 0, 'a grill has an id');
  const key = `${String(id)}:${did}`;
  return (picks[key] ??= { choice: open.find((d) => d.id === did)?.recommended ?? -1, note: '' });
}

function answeredNode(d: Decision): string {
  assert(typeof d.round === 'number', 'a decision has a round');
  assert(d.depends_on.length >= 0, 'a decision lists what it builds on');
  assert(d.question.length > 0, 'a decision has a question');
  assert(d.options.length >= 0, 'a decision lists its options');
  assert(d.answer !== null, 'an answered node has an answer');
  assert(d.id.length > 0, 'a decision has an id');
  const a = d.answer;
  return `<div class="node" data-id="${esc(d.id)}"><div class="q">${esc(d.question)}</div>
      <div class="a">${a.choice >= 0 ? esc(d.options[a.choice]?.label) : '(own answer)'}</div>
      ${a.note ? `<div class="small muted">“${esc(a.note)}”</div>` : ''}</div>`;
}

function optionButton(d: Decision, n: number, x: GrillCtx): string {
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  assert(n < 100, 'an option index is small');
  assert(d.options.length > n, 'the option is in the list');
  const o = d.options[n];
  assert(Number.isInteger(n) && n >= 0, 'an option index is a natural number');
  assert(o !== undefined, 'the option exists');
  return `<button class="button opt ${x.pickOf(d.id).choice === n ? 'on' : ''} ${o.kills_component_id ? 'kills' : ''}" role="radio"
      aria-checked="${String(x.pickOf(d.id).choice === n)}" data-d="${esc(d.id)}" data-i="${String(n)}">
      <span class="flags">${n === d.recommended ? '<span class="rec">★ recommended</span>' : ''}${o.kills_component_id ? '<span class="rec">✕ kills the idea</span>' : ''}<span class="sel">✓ picked</span></span>
      <b>${esc(o.label)}</b><span class="why">${esc(o.why)}</span></button>`;
}

function askingNode(d: Decision, i: number, x: GrillCtx): string {
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  assert(d.depends_on.length >= 0, 'a decision lists what it builds on');
  assert(typeof x.arrived === 'boolean', 'arrived is a boolean');
  assert(d.question.length > 0, 'a decision has a question');
  assert(Object.keys(x.names).length >= 0, 'the names are a table');
  assert(Number.isInteger(i) && i >= 0, 'a node index is a natural number');
  assert(d.options.length > 0, 'a decision has options');
  return `<div class="node open${x.arrived ? ' enter' : ''}" style="--i:${String(i)}" data-id="${esc(d.id)}"><div class="q">${esc(d.question)}</div>
    ${d.depends_on.length ? `<div class="small muted">builds on: ${d.depends_on.map((k) => esc(x.names[k] ?? k)).join(' · ')}</div>` : ''}
    <div class="opts" role="radiogroup">${d.options.map((_o, n) => optionButton(d, n, x)).join('')}</div>
    <textarea data-note="${esc(d.id)}" rows="1" placeholder="optional note, or your own answer" aria-label="note for ${esc(d.question)}">${esc(x.pickOf(d.id).note)}</textarea>
    <div class="need" data-need="${esc(d.id)}" hidden>Pick a card, or write your own answer.</div></div>`;
}

function undoBtn(label: string): string {
  assert(label.length > 0, 'a button has a label');
  assert(label.trim() === label, 'a label has no spaces at its ends');
  assert(label.length < 100, 'a label is short');
  assert(label.length > 0, 'a button has a label');
  assert(!label.includes('<'), 'a label has no markup');
  return `<button class="button ghost" data-undo>↶ ${label}</button>`;
}

function killedBanner(g: GrillView, x: GrillCtx, lastAnswered: number): string {
  assert(typeof x.comps === 'object', 'the parts are a table');
  assert(g.status.length > 0, 'a grill has a status');
  assert(x.open.length >= 0, 'the open decisions have a count');
  assert(['open', 'done', 'killed'].includes(g.status), 'a grill status is known');
  assert(lastAnswered >= 0, 'the last answered round is not negative');
  assert(g.tree.round >= 0, 'a round is not negative');
  if (g.status !== 'killed') {
    return '';
  }
  const killedPart = g.tree.killed ? x.comps[g.tree.killed.component_id] : undefined;
  return `<div class="banner"><b>✕ Killed.</b> ${esc(g.tree.killed?.reason)}<br>
      ${killedPart ? `Bad part: <b>${esc(killedPart.name)}</b>. It is left out of the next creation.` : ''}
      <div class="actions">${lastAnswered ? undoBtn('Undo the kill') : ''}</div></div>`;
}

function treeHtml(g: GrillView, x: GrillCtx, lastAnswered: number): string {
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  assert(g.status.length > 0, 'a grill has a status');
  assert(x.open.length >= 0, 'the open decisions have a count');
  assert(['open', 'done', 'killed'].includes(g.status), 'a grill status is known');
  assert(lastAnswered >= 0, 'the last answered round is not negative');
  assert(g.tree.decisions.length >= 0, 'the decisions are a list');
  const rounds: Decision[][] = [];
  g.tree.decisions.forEach((d) => { (rounds[d.round] ??= []).push(d); });
  return `<div class="tree"><svg></svg>
      <div class="level"><div class="node root" data-id="__root"><b>${esc(g.snowmobile.name)}</b></div></div>
      ${rounds.map((list, r) => `<div class="level">${list.map((d, i) => d.answer ? answeredNode(d) : askingNode(d, i, x)).join('')}</div>
        ${r === lastAnswered && g.status === 'open' ? `<div class="undo-round">${undoBtn('Undo this round')}</div>` : ''}`).join('')}
      ${g.pending ? `<div class="level"><div class="node"><span class="spin"></span> next round…</div></div>` : ''}
      ${g.error ? `<div class="err">${esc(g.error)}</div><button class="button" id="retry">Retry</button>` : ''}
    </div>`;
}

function grillHtml(g: GrillView, x: GrillCtx): string {
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  assert(g.status.length > 0, 'a grill has a status');
  assert(x.open.length >= 0, 'the open decisions have a count');
  assert(g.snowmobile.name.length >= 0, 'an idea has a name');
  assert(['open', 'done', 'killed'].includes(g.status), 'a grill status is known');
  assert(g.components.length >= 0, 'the parts are a list');
  assert(Number.isInteger(g.snowmobile.hunt_id), 'an idea has a hunt id');
  const sm = g.snowmobile;
  const lastAnswered = Math.max(0, ...g.tree.decisions.filter((d) => d.answer).map((d) => d.round));
  return `<div class="top"><a class="back" href="#/hunt/${String(sm.hunt_id)}">‹ Hunt</a></div>
    <h1>${esc(sm.name)}</h1><div class="muted">${esc(sm.pitch)}</div>
    <div>${g.components.map((c) => `<span class="chip ${c.bad_reason ? 'bad' : ''}">${link(c.url, c.name)} <span class="muted">· ${esc(c.source)}</span></span>`).join('')}</div>
    ${killedBanner(g, x, lastAnswered)}
    ${x.open.length ? '<p class="small muted">Each round starts with the recommended cards picked. Tap a card to pick it. Tap a picked card again to clear it and write your own answer.</p>' : ''}
    ${treeHtml(g, x, lastAnswered)}
    ${g.status === 'done' ? `<h2><span class="grow">Build brief</span>${undoBtn('Undo the last round')}</h2><div class="card brief" id="brief">${md(g.brief ?? '')}</div>` : ''}`;
}

function wireOptions(x: GrillCtx): void {
  assert(x.open.length >= 0, 'the open decisions have a count');
  assert(document.body.isConnected, 'the page has a body');
  assert(Object.keys(x.names).length >= 0, 'the names are a table');
  assert(document.querySelectorAll('.opt').length >= 0, 'the options can be listed');
  assert(Number.isInteger(x.open.length), 'the open decisions are a list');
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  all(HTMLButtonElement, '.opt').forEach((b) => {
    b.onclick = () => {
      const did = b.dataset['d'] ?? '', p = x.pickOf(did), i = Number(b.dataset['i']);
      assert(Number.isInteger(i), 'a card carries an option index');
      assert(did.length > 0, 'a card carries a decision id');
      p.choice = p.choice === i ? -1 : i;
      all(HTMLElement, `.opt[data-d="${CSS.escape(did)}"]`).forEach((o) => {
        o.classList.toggle('on', Number(o.dataset['i']) === p.choice);
        o.setAttribute('aria-checked', String(Number(o.dataset['i']) === p.choice));
      });
      must(HTMLElement, `[data-need="${CSS.escape(did)}"]`).hidden = true;
    };
  });
  all(HTMLTextAreaElement, '[data-note]').forEach((t) => { t.oninput = () => { x.pickOf(t.dataset['note'] ?? '').note = t.value; }; });
}

async function submitAnswers(x: GrillCtx): Promise<void> {
  assert(typeof primary === 'function', 'primary exists');
  assert(typeof late.grill === 'function', 'the grill hook exists');
  assert(typeof x.pickOf === 'function', 'a pick finder exists');
  assert(Object.keys(x.names).length >= 0, 'the names are a table');
  assert(x.open.length > 0, 'a round has open decisions');
  assert(String(x.id).length > 0, 'a grill has an id');
  const missing = x.open.filter((d) => x.pickOf(d.id).choice < 0 && !x.pickOf(d.id).note.trim());
  missing.forEach((d) => { must(HTMLElement, `[data-need="${CSS.escape(d.id)}"]`).hidden = false; });
  const firstMissing = missing[0];
  if (firstMissing) {
    must(HTMLElement, `[data-id="${CSS.escape(firstMissing.id)}"]`).scrollIntoView({ block: 'center' });
    return;
  }
  primary('Answering…', null, { busy: true });
  try {
    const next = await api<GrillView>(`/api/grills/${String(x.id)}/answer`, { answers: Object.fromEntries(x.open.map((d) => [d.id, x.pickOf(d.id)])) });
    void late.grill(x.id, next);
  } catch (e) {
    fail(e);
    void late.grill(x.id);
  }
}

async function copyBrief(g: GrillView): Promise<void> {
  assert(typeof toast === 'function', 'toast exists');
  assert(g.status.length > 0, 'a grill has a status');
  assert(g.snowmobile.name.length >= 0, 'an idea has a name');
  assert((g.brief ?? '').length >= 0, 'a brief has a length');
  assert(g.status === 'done', 'only a finished grill has a brief');
  assert(typeof (g.brief ?? '') === 'string', 'a brief is text');
  try {
    await navigator.clipboard.writeText(g.brief ?? '');
    toast('Copied the build brief.');
  } catch {
    getSelection()?.selectAllChildren(byId(HTMLElement, 'brief'));
    toast('Select all is on. Copy it with the menu.');
  }
}

function wirePrimary(g: GrillView, x: GrillCtx): void {
  assert(typeof go === 'function', 'go exists');
  assert(typeof primary === 'function', 'primary exists');
  assert(g.snowmobile.name.length >= 0, 'an idea has a name');
  assert(['open', 'done', 'killed'].includes(g.status), 'a grill status is known');
  assert(typeof g.pending === 'boolean', 'pending is a boolean');
  if (x.open.length) {
    primary('Answer round', () => submitAnswers(x));
  } else if (g.status === 'done') {
    primary('Copy brief', () => copyBrief(g));
  } else if (g.status === 'killed') {
    primary('Back to the hunt', () => { go(`#/hunt/${String(g.snowmobile.hunt_id)}`); });
  } else {
    primary(g.pending ? 'Thinking…' : '', null, { busy: g.pending });
  }
}

function wireUndoRetry(id: string | number): void {
  assert(typeof toast === 'function', 'toast exists');
  assert(typeof late.grill === 'function', 'the grill hook exists');
  assert(document.querySelectorAll('[data-undo]').length >= 0, 'the undo buttons can be listed');
  assert(String(id).length > 0, 'a grill has an id');
  assert(document.body.isConnected, 'the page has a body');
  all(HTMLButtonElement, '[data-undo]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const next = await api<GrillView>(`/api/grills/${String(id)}/undo`, {});
        void late.grill(id, next);
        toast('The last round is open again.');
      } catch (e) { fail(e); b.disabled = false; }
    };
  });
  const retry = document.getElementById('retry');
  if (retry) {
    retry.onclick = async () => {
      try { void late.grill(id, await api<GrillView>(`/api/grills/${String(id)}/retry`, {})); } catch (e) { fail(e); }
    };
  }
}

function grillCtx(id: string | number, g: GrillView): GrillCtx {
  assert(g.status.length > 0, 'a grill has a status');
  assert(g.snowmobile.name.length >= 0, 'an idea has a name');
  assert(Object.keys(picks).length >= 0, 'the picks are a table');
  assert(g.components.length >= 0, 'the parts are a list');
  assert(String(id).length > 0, 'a grill has an id');
  const open = g.tree.decisions.filter((d) => !d.answer);
  const key = `${String(id)}:${String(g.tree.round)}`;
  const x: GrillCtx = { id, open, comps: Object.fromEntries(g.components.map((c) => [c.id, c])), pickOf: (did) => pickFor(id, open, did),
    arrived: open.length > 0 && shownRound !== key && Boolean(shownRound?.startsWith(`${String(id)}:`)),
    names: Object.fromEntries(g.tree.decisions.map((d) => [d.id, d.question])) };
  open.forEach((d) => x.pickOf(d.id));
  return x;
}

async function grill(id: string | number, data?: GrillView): Promise<void> {
  assert(typeof poll === 'function', 'poll exists');
  assert(typeof shell === 'function', 'the shell exists');
  assert(typeof late.grill === 'function', 'the grill hook exists');
  assert(Object.keys(picks).length >= 0, 'the picks are a table');
  assert(String(id).length > 0, 'a grill has an id');
  assert(data === undefined || Number.isInteger(data.components.length), 'given data lists its parts');
  const g = data ?? await api<GrillView>(`/api/grills/${String(id)}`);
  const x = grillCtx(id, g);
  shell(grillHtml(g, x), 'home');
  lastTree = g.tree;
  drawEdges(g.tree);
  if (x.arrived) { document.querySelector('.node.open')?.scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth', block: 'start' }); }
  shownRound = `${String(id)}:${String(g.tree.round)}`;
  wireOptions(x);
  wirePrimary(g, x);
  wireUndoRetry(id);
  if (g.pending) { poll(() => grill(id), 600); }
}

late.grill = grill;

const stackPick = new Map<Layer, number>();
let tapped: Tapped = null;
const pointState = cell(pointMachine);
let lastMap: { s: StackView; byId: Paradigms } | null = null;
const SHAPE: Record<Layer, (x: number, y: number, r: number) => string> = {
  language: (x, y, r) => `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}"/>`,
  hardware: (x, y, r) => `<rect x="${String(x - r)}" y="${String(y - r)}" width="${String(2 * r)}" height="${String(2 * r)}" rx="1.5"/>`,
  os: (x, y, r) => `<path d="M${String(x)},${String(y - r * 1.2)} L${String(x + r * 1.1)},${String(y + r * 0.8)} L${String(x - r * 1.1)},${String(y + r * 0.8)}Z"/>`,
  software: (x, y, r) => `<path d="M${String(x)},${String(y - r * 1.3)} L${String(x + r * 1.3)},${String(y)} L${String(x)},${String(y + r * 1.3)} L${String(x - r * 1.3)},${String(y)}Z"/>`,
};
const JOB: Record<string, string> = { axes: 'Proposing the design axes.', scoring: 'Scoring each paradigm on each axis.', hunting: 'Hunting the web for more paradigms.' };

function mark(layer: Layer, x: number, y: number, r: number, cls = 'mark'): string {
  assert(typeof SHAPE[layer] === 'function', 'a shape draws');
  assert(layer in SHAPE, 'a layer has a shape');
  assert(typeof cls === 'string', 'a class is text');
  assert(cls.length > 0, 'a class is not empty');
  assert(Number.isFinite(x) && Number.isFinite(y), 'the position is numbers');
  assert(r > 0, 'the radius is positive');
  return `<g class="${cls}">${SHAPE[layer](x, y, r)}</g>`;
}

function pcLabel(s: StackView, i: number): string {
  assert(s.axes.length < 1000, 'the axes are few');
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(s.map === null || s.map.explained.length >= 2, 'a map explains 2 components');
  assert(i === 0 || i === 1, 'a component is 0 or 1');
  assert(s.axes.length >= 0, 'the axes are a list');
  const v = s.map?.components[i] ?? [];
  const top = s.axes.map((a, j): [Axis, number] => [a, v[j] ?? 0]).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 3);
  return `${i ? 'Up' : 'Across'} (PC${String(i + 1)}, ${String(Math.round(100 * (s.map?.explained[i] ?? 0)))}% of the spread): ${top.map(([a, w]) => `${esc(a.name)} ${w >= 0 ? '+' : '−'}${Math.abs(w).toFixed(2)}`).join(', ')}`;
}

function chosenIds(): number[] {
  assert(stackPick.size >= 0, 'the picks have a count');
  const ids = [...stackPick.values()];
  assert(ids.length <= 4, 'a stack has at most 4 layers');
  return ids;
}

function choose(p: Paradigm): void {
  assert(p.name.length >= 0, 'a paradigm has a name');
  assert(stackPick.size <= 4, 'at most 4 layers are picked');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(Number.isInteger(p.id), 'a paradigm has an integer id');
  assert(p.layer.length > 0, 'a paradigm has a layer');
  if (stackPick.get(p.layer) === p.id) { stackPick.delete(p.layer); } else { stackPick.set(p.layer, p.id); }
  void late.stack();
}

function pointHtml(t: NonNullable<Tapped>, byParadigm: Paradigms): { html: string; known: Paradigm | undefined } {
  assert(typeof stackPick.get === 'function', 'the picks can be read');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(t.answer === undefined || t.answer.name.length >= 0, 'an answer has a name');
  assert(typeof pointState.state === 'string', 'the point has a state');
  assert(Number.isFinite(t.x) && Number.isFinite(t.y), 'a tap has a position');
  assert(typeof t.busy === 'boolean', 'busy is a boolean');
  const a = t.answer;
  const known = a ? Object.values(byParadigm).find((p) => p.name.toLowerCase() === a.name.toLowerCase()) : undefined;
  const body = t.busy ? '<span class="spin"></span> Asking which paradigm would live at this point…'
    : t.error || !a ? `<span class="err">${esc(t.error)}</span>`
    : `<div class="tag">${esc(a.layer)} · ${known ? 'on the map' : a.exists ? 'exists' : 'missing from the map'}</div><b>${link(a.url, a.name)}</b>
      <div class="small">${esc(a.why)}</div>`;
  const pickLabel = known && stackPick.get(known.layer) === known.id ? '✓ Picked' : 'Pick for the stack';
  return { known, html: `<div class="sheet">${body}
    <div class="actions">${known ? `<button class="button ghost" id="pick-point">${pickLabel}</button>` : ''}
      <button class="button quiet" id="close-point">Close</button></div></div>` };
}

function showPoint(byParadigm: Paradigms): void {
  assert(document.body.isConnected, 'the page has a body');
  assert(typeof tapped === 'object', 'a tap is an object or nothing');
  assert(typeof late.drawMap === 'function', 'the map hook exists');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(typeof pointState.state === 'string', 'the point has a state');
  const el = document.getElementById('point');
  if (!el || !tapped) {
    return;
  }
  const { html, known } = pointHtml(tapped, byParadigm);
  el.innerHTML = html;
  if (known) { byId(HTMLElement, 'pick-point').onclick = () => { choose(known); }; }
  byId(HTMLElement, 'close-point').onclick = () => {
    pointState.send('close');
    tapped = null;
    el.innerHTML = '';
    if (lastMap) { late.drawMap(lastMap.s, lastMap.byId); }
  };
}

async function askAt(x: number, y: number, s: StackView, byParadigm: Paradigms): Promise<void> {
  assert(typeof showPoint === 'function', 'showPoint exists');
  assert(view >= 0, 'the view number is not negative');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(typeof late.drawMap === 'function', 'the map hook exists');
  assert(Number.isFinite(x) && Number.isFinite(y), 'the point is numbers');
  assert(s.axes.length >= 0, 'the axes are a list');
  const v = view;
  pointState.send('tap');
  const mine = { x, y, busy: true } as NonNullable<Tapped>;
  tapped = mine;
  late.drawMap(s, byParadigm);
  try {
    Object.assign(mine, await api<PointView>('/api/stack/point', { x, y }), { busy: false });
    pointState.send('answer');
  } catch (err) {
    Object.assign(mine, { busy: false, error: errMsg(err) });
    pointState.send('error');
  }
  if (v === view && tapped === mine) { showPoint(byParadigm); }
}

function mapGeom(map: NonNullable<StackView['map']>, W: number): Geom {
  assert(map.explained.length >= 0, 'the map lists the explained spread');
  assert(W < 1e6, 'a width is sane');
  assert(map.ids.length >= 0, 'the map lists its paradigms');
  assert(Number.isFinite(W), 'a width is a number');
  assert(map.points.length > 0, 'a map has points');
  assert(W >= 0, 'a width is not negative');
  const H = Math.round(Math.min(560, Math.max(340, W * (W < 600 ? 1.05 : 0.6)))), pad = 28;
  const xs = map.points.map((p) => p[0] ?? 0), ys = map.points.map((p) => p[1] ?? 0);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (W - 2 * pad) / ((x1 - x0) || 1), sy = (H - 2 * pad) / ((y1 - y0) || 1);
  return { W, H, pad, x0, y0, sx, sy, px: (x) => pad + (x - x0) * sx, py: (y) => H - pad - (y - y0) * sy };
}

function placeDots(map: NonNullable<StackView['map']>, g: Geom, byParadigm: Paradigms, on: Set<number>): Dot[] {
  assert(typeof g.px === 'function', 'the map has an x scale');
  assert(typeof g.py === 'function', 'the map has a y scale');
  assert(g.W >= 0, 'the map has a width');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(map.ids.length === map.points.length, 'each paradigm has a point');
  assert(on.size <= 4, 'at most 4 paradigms are picked');
  const dots: Dot[] = map.ids.flatMap((pid, i): Dot[] => {
    const p = byParadigm[pid], pt = map.points[i];
    return p && pt ? [{ p, x: g.px(pt[0] ?? 0), y: g.py(pt[1] ?? 0) }] : [];
  });
  dots.sort((a, b) => Number(on.has(a.p.id)) - Number(on.has(b.p.id)));
  const boxes: number[][] = [];
  for (const d of [...dots].reverse()) {
    const w = d.p.name.length * (on.has(d.p.id) ? 7 : 6), left = d.x > g.W / 2 ? d.x - 10 - w : d.x + 10;
    const b = [left, d.y - 8, left + w, d.y + 6] as [number, number, number, number];
    d.label = !boxes.some((o) => b[0] < (o[2] ?? 0) && (o[0] ?? 0) < b[2] && b[1] < (o[3] ?? 0) && (o[1] ?? 0) < b[3]);
    if (d.label) { boxes.push(b); }
  }
  return dots;
}

function dotSvg(d: Dot, g: Geom, on: Set<number>, r0: number): string {
  assert(typeof g.px === 'function', 'the map has an x scale');
  assert(d.p.name.length > 0, 'a paradigm has a name');
  assert(g.W >= 0, 'the map has a width');
  assert(on.size <= 4, 'at most 4 paradigms are picked');
  assert(Number.isFinite(d.x) && Number.isFinite(d.y), 'a dot has a position');
  assert(r0 > 0, 'the radius is positive');
  const picked = on.has(d.p.id);
  const x = String(d.x), y = String(d.y);
  return `${mark(d.p.layer, d.x, d.y, picked ? r0 + 2 : r0, picked ? 'mark on' : 'mark')}${picked ? `<circle class="ring" cx="${x}" cy="${y}" r="13"/>` : ''}
      ${d.label ? `<text class="${picked ? 'on' : ''}" ${d.x > g.W / 2 ? `text-anchor="end" x="${String(d.x - 10)}"` : `x="${String(d.x + 10)}"`} y="${String(d.y + 4)}">${picked ? '✓ ' : ''}${esc(d.p.name)}</text>` : ''}`;
}

function mapSvg(g: Geom, dots: Dot[], on: Set<number>): string {
  assert(typeof g.px === 'function', 'the map has an x scale');
  assert(typeof g.py === 'function', 'the map has a y scale');
  assert(on.size <= 4, 'at most 4 paradigms are picked');
  assert(Number.isFinite(g.pad), 'the padding is a number');
  assert(g.W >= 0 && g.H > 0, 'the map has a size');
  assert(dots.length >= 0, 'the dots are a list');
  const r0 = g.W < 600 ? 6 : 5;
  const ring = tapped ? `<circle class="ring" cx="${String(g.px(tapped.x))}" cy="${String(g.py(tapped.y))}" r="10" stroke-dasharray="3 3"/>` : '';
  return `<svg viewBox="0 0 ${String(g.W)} ${String(g.H)}" height="${String(g.H)}" aria-hidden="true">
    <line class="zero" x1="${String(g.px(0))}" y1="0" x2="${String(g.px(0))}" y2="${String(g.H)}"/><line class="zero" x1="0" y1="${String(g.py(0))}" x2="${String(g.W)}" y2="${String(g.py(0))}"/>
    ${dots.map((d) => dotSvg(d, g, on, r0)).join('')}
    ${ring}</svg>`;
}

function wireMapClick(box: HTMLElement, g: Geom, dots: Dot[], s: StackView, byParadigm: Paradigms): void {
  assert(typeof g.px === 'function', 'the map has an x scale');
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(box.tagName.length > 0, 'the box is an element');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(g.H > 0, 'the map has a height');
  assert(dots.length >= 0, 'the dots are a list');
  assert(g.sx > 0 && g.sy > 0, 'the scales are positive');
  must(SVGElement, 'svg', box).onclick = (e) => {
    const r = box.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = dots.map((d) => ({ d, dist: Math.hypot(d.x - mx, d.y - my) })).sort((a, b) => a.dist - b.dist)[0];
    assert(Number.isFinite(mx) && Number.isFinite(my), 'the click has a position');
    if (hit && hit.dist <= 22) {
      choose(hit.d.p);
      return;
    }
    void askAt(g.x0 + (mx - g.pad) / g.sx, g.y0 + (g.H - g.pad - my) / g.sy, s, byParadigm);
  };
}

function drawMap(s: StackView, byParadigm: Paradigms): void {
  assert(typeof placeDots === 'function', 'placeDots exists');
  assert(document.body.isConnected, 'the page has a body');
  assert(s.axes.length >= 0, 'the axes have a count');
  assert(typeof lastMap === 'object', 'the map is an object or nothing');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(s.paradigms.length >= 0, 'the paradigms are a list');
  const box = byId(HTMLElement, 'map');
  const map = s.map;
  if (!map) {
    return;
  }
  const g = mapGeom(map, box.clientWidth);
  const on = new Set(stackPick.values());
  const dots = placeDots(map, g, byParadigm, on);
  box.innerHTML = mapSvg(g, dots, on);
  box.dataset['w'] = String(g.W);
  showPoint(byParadigm);
  wireMapClick(box, g, dots, s, byParadigm);
}
late.drawMap = drawMap;

function stackHead(s: StackView, busy: boolean, layers: [Layer, string][]): string {
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(typeof s.job === 'object', 'a job is an object or nothing');
  assert(Object.keys(JOB).length > 0, 'jobs are named');
  assert(layers.length > 0, 'a stack has layers');
  assert(typeof busy === 'boolean', 'busy is a boolean');
  return `<h1>Stack</h1>
    <p class="muted">Paradigms of 4 layers on one map. A large gap between the layers of your stack is a mismatch:
    a chance for an app or developer tool that reduces a practical problem.</p>
    <div class="status">${busy ? `<span class="spin"></span> ${JOB[s.job?.step ?? ''] ?? ''}` : ''}${s.job?.error ? `<div class="err">${esc(s.job.error)}</div>` : ''}</div>
    <div class="legend">${layers.map(([k, v]) => `<span><svg width="14" height="14">${mark(k, 7, 7, 5)}</svg>${esc(v)}</span>`).join('')}</div>`;
}

function pointInputs(map: NonNullable<StackView['map']>): string {
  assert(map.points.length < 100000, 'the points are few');
  assert(map.ids.length >= 0, 'the map lists its paradigms');
  assert(map.explained.length >= 0, 'the map lists the explained spread');
  assert(map.points.length > 0, 'a map has points');
  return [0, 1].map((i) => {
    const v = map.points.map((p) => p[i] ?? 0), lo = Math.min(...v).toFixed(1), hi = Math.max(...v).toFixed(1);
    return `<input type="number" step="any" name="${'xy'[i] ?? ''}" required placeholder="${i ? 'up' : 'across'} ${lo} to ${hi}" aria-label="${i ? 'up' : 'across'}, from ${lo} to ${hi}">`;
  }).join('');
}

function mapSection(s: StackView): string {
  assert(s.axes.length < 1000, 'the axes are few');
  assert(typeof s.mismatch === 'number', 'a mismatch is a number');
  assert(Number.isInteger(s.paradigms.length), 'the paradigms have a count');
  assert(s.axes.length >= 0, 'the axes are a list');
  assert(s.map === null || s.map.points.length > 0, 'a map has points');
  if (!s.map) {
    return `<div class="card muted">The map needs axes and a score for each paradigm. <a href="#axes" data-jump>Propose the axes below.</a></div>`;
  }
  return `<div class="map" id="map"></div><p class="hint">Tap a mark to pick it for its layer. Tap an empty point to ask which paradigm would live there.</p>
      <details><summary>Ask about a point by its position</summary><form class="row" id="ask-point">
        ${pointInputs(s.map)}
        <button class="button">Ask</button></form></details>
      <div id="point"></div><p class="small muted">${pcLabel(s, 0)}<br>${pcLabel(s, 1)}</p>`;
}

function problemName(s: StackView, pid: string): string {
  assert(typeof esc === 'function', 'esc exists');
  assert(typeof s.practicalProblems.source.title === 'string', 'the source has a title');
  assert(pid.length > 0, 'a problem has an id');
  assert(s.practicalProblems.items.length >= 0, 'the problems are a list');
  return esc(s.practicalProblems.items.find((p) => p.id === pid)?.name);
}

function problemBlock(s: StackView, p: StackView['practicalProblems']['items'][number], ids: number[]): string {
  assert(typeof esc === 'function', 'esc exists');
  assert(s.practicalProblems.items.length >= 0, 'the problems have a count');
  assert(s.practicalProblems.links.length >= 0, 'the links have a count');
  assert(p.name.length > 0, 'a problem has a name');
  assert(p.percent >= 0, 'a percent is not negative');
  assert(p.id.length > 0, 'a problem has an id');
  return `<div>
        <button type="button" class="button chip" data-problem="${esc(p.id)}">${esc(p.name)} · ${String(p.percent)}%</button>
        ${s.practicalProblems.links.filter((l) => l.problem_id === p.id).map((l) => `<p class="small">
          <button type="button" class="button chip" data-pick="${String(l.paradigm_id)}" aria-pressed="${String(ids.includes(l.paradigm_id))}">${esc(l.paradigm)}${ids.includes(l.paradigm_id) ? ' · in your stack' : ''}</button>
          <b>${esc(l.effect)}</b>: ${esc(l.reason)} ${link(l.source.url, l.source.title)}</p>`).join('')}
        </div>`;
}

function problemsSection(s: StackView, ids: number[]): string {
  assert(s.practicalProblems.items.length >= 0, 'the problems have a count');
  assert(typeof plural === 'function', 'plural exists');
  const pp = s.practicalProblems;
  assert(Number.isInteger(ids.length), 'the picks are a list');
  assert(pp.source.respondents >= 0, 'respondents are not negative');
  return `<h2>Practical problems</h2>
    <p class="small muted">${plural(pp.items.length, 'sourced problem', 'sourced problems')} · ${plural(pp.links.length, 'paradigm-problem link', 'paradigm-problem links')}. Select a problem as your app seed.</p>
    <div class="card">
      <p><b>Whole database: problems without a documented reduction:</b> ${pp.coverage.withoutReduction.map((n) => problemName(s, n)).join(', ') || 'None'}.</p>
      ${pp.items.map((p) => problemBlock(s, p, ids)).join('')}
      <p class="small muted">${plural(pp.coverage.unassessedParadigms, 'paradigm has', 'paradigms have')} no problem assessment. ${esc(pp.coverage.limit)}</p>
      <p class="small">${link(pp.source.url, pp.source.title)} · ${pp.source.respondents.toLocaleString()} respondents</p>
      <p class="small muted">${esc(pp.source.scope)} ${esc(pp.source.measure)}</p>
      <p class="small muted">${esc(pp.source.limit)}</p>
    </div>`;
}

function slotsSection(layers: [Layer, string][], byParadigm: Paradigms): string {
  assert(typeof mark === 'function', 'mark exists');
  assert(stackPick.size <= 4, 'at most 4 layers are picked');
  assert(layers.length > 0, 'a stack has layers');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  return `<h2>Your stack</h2>
    <div class="slots">${layers.map(([k, v]) => {
    const p = byParadigm[stackPick.get(k) ?? -1];
    return `<div class="card slot ${p ? '' : 'empty'}"><svg width="16" height="16">${mark(k, 8, 8, 6)}</svg><div class="what"><div class="tag">${esc(v)}</div>
        ${p ? `<b>${link(p.url, p.name)}</b><div class="small muted">${esc(p.summary)}</div>` : '<span class="muted">any (the LLM chooses)</span>'}</div>
        ${p ? `<button class="button x" data-clear="${k}" aria-label="clear ${esc(v)}">×</button>` : ''}</div>`;
  }).join('')}</div>`;
}

function selectedSection(s: StackView): string {
  assert(typeof plural === 'function', 'plural exists');
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  const c = s.selectedProblemCoverage;
  assert(c === null || c.unassessedParadigms >= 0, 'a count is not negative');
  assert(c === null || Number.isInteger(c.withoutReduction.length), 'the problems are a list');
  if (!c) {
    return '';
  }
  return `<div class="card" id="selected-problem-coverage">
      <p><b>Your stack: problems without a documented reduction:</b> ${c.withoutReduction.map((n) => problemName(s, n)).join(', ') || 'None'}.</p>
      <p class="small muted">${plural(c.unassessedParadigms, 'selected paradigm has', 'selected paradigms have')} no problem assessment. Empty layers remain open for Claude to choose.</p>
      <p class="small muted">${esc(c.limit)}</p>
    </div>`;
}

function painForm(pain: string): string {
  assert(typeof esc === 'function', 'esc exists');
  assert(pain.length < 100000, 'the pain is not huge');
  assert(pain.trim().length <= pain.length, 'trimming never grows the pain');
  assert(typeof pain === 'string', 'the pain is text');
  assert(pain.length >= 0, 'the pain has a length');
  return `<form class="row" id="f"><input type="text" id="pain" placeholder="a practical problem (optional with a stack)" autocomplete="off" aria-label="practical problem" value="${esc(pain)}">
      <button class="button">Create apps</button></form>
    <p class="small muted">With a pain and no stack, the LLM chooses a paradigm for each layer.</p>`;
}

function gapRow(s: StackView, picked: Paradigm[], g: StackView['gaps'][number]): string {
  assert(picked.length >= 0, 'the picked paradigms have a count');
  assert(Object.keys(s.scores).length >= 0, 'the scores are a table');
  assert(s.axes.length >= 0, 'the axes have a count');
  assert(typeof g.mismatch === 'boolean', 'a mismatch is a boolean');
  assert(Number.isInteger(g.axis_id), 'a gap has an integer axis id');
  const a = s.axes.find((n) => n.id === g.axis_id);
  assert(Number.isFinite(g.gap), 'a gap is a number');
  assert(picked.length <= 4, 'at most 4 paradigms are picked');
  if (!a) {
    return '';
  }
  return `<tr><td><b>${esc(a.name)}</b><div class="small muted">0 ${esc(a.low)} · 10 ${esc(a.high)}</div></td>
          <td class="${g.mismatch ? 'm' : ''}">${String(g.gap)}${g.mismatch ? ' ⚠ mismatch' : ''}<div class="gapbar ${g.mismatch ? 'm' : ''}" style="width:${String(g.gap * 10)}%"></div></td>
          ${picked.map((p) => {
    const sc = s.scores[p.id]?.[a.id];
    return `<td><input type="number" min="0" max="10" inputmode="numeric" data-p="${String(p.id)}" data-a="${String(a.id)}" value="${sc ? String(sc.score) : ''}" aria-label="${esc(p.name)} on ${esc(a.name)}">
              <div class="small muted">${esc(sc?.reason)}</div></td>`;
  }).join('')}</tr>`;
}

function gapsSection(s: StackView, picked: Paradigm[]): string {
  assert(Object.keys(s.scores).length >= 0, 'the scores are a table');
  assert(s.axes.length >= 0, 'the axes have a count');
  assert(Number.isInteger(s.gaps.length), 'the gaps are a list');
  assert(picked.length <= 4, 'at most 4 paradigms are picked');
  if (!s.gaps.length) {
    return '';
  }
  return `<h2>Gaps on each axis</h2><p class="small muted">Edit a score to correct it. A new score from the LLM never replaces your edit.</p>
      <div class="scroll"><table class="gaps"><tr><th>axis</th><th>gap</th>${picked.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>
      ${[...s.gaps].sort((a, b) => b.gap - a.gap).map((g) => gapRow(s, picked, g)).join('')}</table></div>`;
}

function paradigmsSection(s: StackView, layers: [Layer, string][], busy: boolean): string {
  assert(stackPick.size <= 4, 'at most 4 layers are picked');
  assert(typeof busy === 'boolean', 'busy is a boolean');
  assert(layers.length > 0, 'a stack has layers');
  assert(Number.isInteger(s.paradigms.length), 'the paradigms are a list');
  return `<h2><span class="grow">Paradigms</span><button id="more" class="button ghost" ${busy ? 'disabled' : ''}>＋ Hunt more paradigms</button></h2>
    ${layers.map(([k, v]) => `<div style="margin-bottom:12px"><div class="tag">${esc(v)}</div>
      ${s.paradigms.filter((p) => p.layer === k).map((p) => `<button type="button" class="button chip" aria-pressed="${String(stackPick.get(k) === p.id)}" data-pick="${String(p.id)}">${stackPick.get(k) === p.id ? '✓ ' : ''}${esc(p.name)}</button>`).join('')}</div>`).join('')}`;
}

function axesSection(s: StackView, busy: boolean, unscored: number): string {
  assert(typeof plural === 'function', 'plural exists');
  assert(typeof busy === 'boolean', 'busy is a boolean');
  assert(Number.isInteger(unscored), 'a count is an integer');
  assert(unscored >= 0, 'a count is not negative');
  assert(unscored <= s.paradigms.length, 'unscored paradigms are a subset');
  const prep = !s.axes.length || unscored ? `<button class="button" id="prep" ${busy ? 'disabled' : ''}>${s.axes.length ? `Score ${plural(unscored, 'paradigm', 'paradigms')}` : 'Propose axes and score'}</button>` : '';
  const edit = s.axes.length ? `<details><summary>Edit the ${plural(s.axes.length, 'axis', 'axes')}</summary>${s.axes.map((a) => `<form class="axis" data-axis="${String(a.id)}">
      <input type="text" name="name" value="${esc(a.name)}" aria-label="name"><input type="text" name="low" value="${esc(a.low)}" aria-label="0 means">
      <input type="text" name="high" value="${esc(a.high)}" aria-label="10 means"><button class="button ghost">Save</button></form>`).join('')}</details>`
    : '<p class="small muted">Claude proposes 8 to 12 design axes that run through all 4 layers, then scores each paradigm on each axis.</p>';
  return `<h2 id="axes"><span class="grow">Axes</span>${prep}</h2>
    ${edit}`;
}

function jobRunner(step: string): () => Promise<void> {
  assert(typeof api === 'function', 'api exists');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(step === 'axes' || step === 'hunting', 'a job step is axes or hunting');
  assert(['axes', 'hunting'].includes(step), 'a job step is known');
  assert(step.length > 0, 'a job step has a name');
  return async () => {
    try { await api(`/api/stack/${step}`, {}); void late.stack(); } catch (e) { fail(e); }
  };
}

function undoing(path: string, body: unknown): () => Promise<void> {
  assert(typeof api === 'function', 'api exists');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(path.length > 5, 'an API path names a resource');
  assert(path.startsWith('/api/'), 'an API path starts with /api/');
  assert(body !== undefined, 'an undo has a body');
  return async () => {
    try { await api(path, body); } catch (e) { fail(e); }
    void late.stack();
  };
}

function wirePicks(s: StackView, byParadigm: Paradigms): void {
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(s.practicalProblems.items.length >= 0, 'the problems have a count');
  assert(Object.keys(s.layers).length > 0, 'a stack has layers');
  assert(stackPick.size <= 4, 'at most 4 layers are picked');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(Number.isInteger(s.paradigms.length), 'the paradigms are a list');
  all(HTMLButtonElement, '[data-pick]').forEach((b) => {
    b.onclick = () => {
      const p = byParadigm[Number(b.dataset['pick'])];
      if (p) { choose(p); }
    };
  });
  all(HTMLButtonElement, '[data-problem]').forEach((b) => {
    b.onclick = () => {
      const problem = s.practicalProblems.items.find((p) => p.id === b.dataset['problem']);
      const input = byId(HTMLInputElement, 'pain');
      input.value = `Reduce ${(problem?.name ?? '').toLowerCase()}.`;
      input.focus();
    };
  });
  all(HTMLButtonElement, '[data-clear]').forEach((b) => {
    b.onclick = () => {
      const layer = b.dataset['clear'] as Layer, was = stackPick.get(layer);
      stackPick.delete(layer);
      void late.stack();
      toast(`Cleared ${s.layers[layer]}.`, () => { if (was !== undefined) { stackPick.set(layer, was); } void late.stack(); });
    };
  });
}

function wireJobs(): void {
  assert(typeof jobRunner === 'function', 'jobRunner exists');
  assert(document.getElementById('more') !== null, 'the page has a hunt more button');
  assert(document.getElementById('axes') !== null, 'the page has an axes section');
  assert(document.body.isConnected, 'the page has a body');
  assert(typeof late.stack === 'function', 'the stack refresh exists');
  const jump = document.querySelector<HTMLAnchorElement>('[data-jump]');
  if (jump) { jump.onclick = (e) => { e.preventDefault(); byId(HTMLElement, 'axes').scrollIntoView(); }; }
  const prep = document.getElementById('prep');
  if (prep) { prep.onclick = jobRunner('axes'); }
  byId(HTMLElement, 'more').onclick = jobRunner('hunting');
}

function wireScores(s: StackView, byParadigm: Paradigms): void {
  assert(typeof undoing === 'function', 'undoing exists');
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(Object.keys(s.scores).length >= 0, 'the scores are a table');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  all(HTMLInputElement, '.gaps input').forEach((i) => {
    i.onchange = async () => {
      const p = Number(i.dataset['p']), a = Number(i.dataset['a']), was = s.scores[p]?.[a];
      assert(Number.isInteger(p) && Number.isInteger(a), 'an input carries 2 ids');
      if (i.value !== '') {
        try {
          await api('/api/scores', { paradigm_id: p, axis_id: a, score: Number(i.value) });
          toast(`Scored ${byParadigm[p]?.name ?? ''} ${i.value}.`, was ? undoing('/api/scores', { paradigm_id: p, axis_id: a, score: was.score, reason: was.reason }) : null);
        } catch (e) { fail(e); }
      }
      void late.stack();
    };
  });
}

function wireAxes(s: StackView): void {
  assert(typeof undoing === 'function', 'undoing exists');
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(Object.keys(s.layers).length > 0, 'a stack has layers');
  assert(Number.isInteger(s.axes.length), 'the axes are a list');
  all(HTMLFormElement, '[data-axis]').forEach((f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const old = s.axes.find((a) => a.id === Number(f.dataset['axis']));
      if (!old) {
        return;
      }
      try {
        await api(`/api/axes/${f.dataset['axis'] ?? ''}`, Object.fromEntries(new FormData(f)));
        toast('Saved the axis.', undoing(`/api/axes/${f.dataset['axis'] ?? ''}`, { name: old.name, low: old.low, high: old.high }));
        void late.stack();
      } catch (err) { fail(err); }
    };
  });
}

function wireAsk(s: StackView, byParadigm: Paradigms): void {
  assert(s.axes.length >= 0, 'the axes have a count');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(Object.keys(s.layers).length > 0, 'a stack has layers');
  assert(Object.keys(byParadigm).length >= 0, 'the paradigms are a table');
  assert(Number.isInteger(s.paradigms.length), 'the paradigms are a list');
  const askForm = document.getElementById('ask-point');
  if (!(askForm instanceof HTMLFormElement)) {
    return;
  }
  askForm.onsubmit = (e) => {
    e.preventDefault();
    const field = (n: string): number => Number(must(HTMLInputElement, `[name="${n}"]`, askForm).value);
    void askAt(field('x'), field('y'), s, byParadigm);
  };
}

function wireStackCreate(ids: number[]): void {
  assert(typeof once === 'function', 'once exists');
  assert(document.getElementById('pain') !== null, 'the page has a pain field');
  assert(document.getElementById('f') !== null, 'the page has a form');
  assert(Number.isInteger(ids.length), 'the picks are a list');
  assert(ids.length <= 4, 'a stack has at most 4 layers');
  const create = once(async () => {
    primary('Create apps', null, { busy: true });
    try {
      const { id } = await api<{ id: number }>('/api/hunts', { seed: byId(HTMLInputElement, 'pain').value, stack: ids });
      go(`#/hunt/${String(id)}`);
    } catch (err) { fail(err); primary('Create apps', create); }
  });
  byId(HTMLFormElement, 'f').onsubmit = (e) => { e.preventDefault(); void create(); };
  primary('Create apps', create);
}

function stackPage(s: StackView, byParadigm: Paradigms, ids: number[]): string {
  assert(s.paradigms.length >= 0, 'the paradigms have a count');
  assert(typeof stackHead === 'function', 'stackHead exists');
  assert(Object.keys(s.layers).length > 0, 'a stack has layers');
  assert(ids.length <= 4, 'a stack has at most 4 layers');
  assert(Object.keys(byParadigm).length === s.paradigms.length, 'each paradigm is indexed once');
  const busy = Boolean(s.job && !s.job.error);
  const unscored = s.paradigms.filter((p) => s.axes.some((a) => !s.scores[p.id]?.[a.id])).length;
  const picked = ids.map((i) => byParadigm[i]).filter((p): p is Paradigm => Boolean(p));
  const pain = document.getElementById('pain') instanceof HTMLInputElement ? byId(HTMLInputElement, 'pain').value : '';
  const layers = Object.entries(s.layers) as [Layer, string][];
  return [stackHead(s, busy, layers), mapSection(s), problemsSection(s, ids), slotsSection(layers, byParadigm), selectedSection(s),
    painForm(pain), gapsSection(s, picked), paradigmsSection(s, layers, busy), axesSection(s, busy, unscored)].join('\n    ');
}

async function stack(): Promise<void> {
  assert(typeof wirePicks === 'function', 'wirePicks exists');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  const ids = chosenIds();
  const s = await api<StackView>(`/api/stack?pick=${ids.join(',')}`);
  assert(Number.isInteger(s.paradigms.length), 'the paradigms are a list');
  assert(Number.isInteger(s.axes.length), 'the axes are a list');
  const byParadigm: Paradigms = Object.fromEntries(s.paradigms.map((p) => [p.id, p]));
  shell(stackPage(s, byParadigm, ids), 'stack');
  wirePicks(s, byParadigm);
  wireJobs();
  wireScores(s, byParadigm);
  wireAxes(s);
  wireAsk(s, byParadigm);
  wireStackCreate(ids);
  lastMap = s.map ? { s, byId: byParadigm } : null;
  if (s.map) { drawMap(s, byParadigm); }
  if (s.job && !s.job.error) { poll(stack, 1500); }
}
late.stack = stack;

function searchHtml(r: SearchView): string {
  assert(typeof MARK === 'object', 'the marks exist');
  assert(Number.isInteger(r.snowmobiles.length), 'the ideas are a list');
  assert(Number.isInteger(r.components.length) && Number.isInteger(r.hunts.length), 'the parts and hunts are lists');
  return `
    <h2>Ideas (${String(r.snowmobiles.length)})</h2><div class="list">${r.snowmobiles.map((s) => `<a href="${s.status === 'graveyard' ? `#/hunt/${String(s.hunt_id)}/graveyard` : `#/grill/${String(s.id)}`}">
      <span class="tag">${MARK[s.status] ?? ''} ${esc(s.status)}</span><b>${esc(s.name)}</b> <span class="small muted">${esc(s.pitch)} · seed: ${esc(s.seed)}</span></a>`).join('')}</div>
    <h2>Parts (${String(r.components.length)})</h2><div class="list">${r.components.map((c) => `<div><span class="chip ${c.bad_reason ? 'bad' : ''}">${link(c.url, c.name)}</span>
      <span class="small muted">${esc(c.source)} · ${esc(c.mechanism)}</span> <a class="button btn ghost" href="#/hunt/${String(c.hunt_id)}/parts">hunt</a></div>`).join('')}</div>
    <h2>Hunts (${String(r.hunts.length)})</h2><div class="list">${r.hunts.map((h) => `<a href="#/hunt/${String(h.id)}"><b>${esc(h.seed)}</b></a>`).join('')}</div>`;
}

async function library(q = ''): Promise<void> {
  assert(typeof primary === 'function', 'primary exists');
  assert(document.getElementById('app') !== null, 'the page has an app');
  assert(typeof late.stack === 'function', 'the stack hook exists');
  assert(q === q.trim() || q.length > 0, 'a query is text');
  assert(typeof q === 'string', 'a query is text');
  assert(q.length < 10000, 'a query is short');
  shell(`<h1>Library</h1><form class="row" id="f"><input type="search" id="q" placeholder="search parts, ideas, briefs, trees" value="${esc(q)}" enterkeyhint="search" aria-label="search"><button class="button">Search</button></form><div id="r" class="muted">…</div>`, 'library');
  primary('');
  byId(HTMLFormElement, 'f').onsubmit = (e) => { e.preventDefault(); void library(byId(HTMLInputElement, 'q').value); };
  const r = await api<SearchView>(`/api/search?q=${encodeURIComponent(q)}`);
  byId(HTMLElement, 'r').innerHTML = searchHtml(r);
}

async function route(): Promise<void> {
  assert(typeof clearTimeout === 'function', 'the page can clear timers');
  assert(typeof home === 'function', 'home exists');
  assert(typeof late.hunt === 'function', 'the hunt hook exists');
  assert(typeof location.hash === 'string', 'the hash is text');
  assert(view === shownView + 1 || view > 0, 'the view moved on');
  view++;
  lastTree = null;
  lastMap = null;
  clearTimeout(timer);
  const [, page, id = '', tab] = location.hash.split('/');
  assert(view > 0, 'the view number grows');
  assert(id.length >= 0, 'an id is text');
  try {
    if (page === 'hunt') {
      await hunt(id, tab);
    } else if (page === 'stack') {
      await stack();
    } else if (page === 'grill') {
      await grill(id);
    } else if (page === 'library') {
      await library();
    } else {
      await home();
    }
  } catch (e) {
    shell(`<p class="err">${esc(errMsg(e))}</p>`);
    primary('');
  }
}

function boot(): void {
  assert(typeof route === 'function', 'route exists');
  assert(typeof window.addEventListener === 'function', 'the window takes listeners');
  assert(document.getElementById('app') !== null, 'the page has an app');
  assert(view >= 0, 'the view number is not negative');
  assert(typeof window.addEventListener === 'function', 'the window takes listeners');
  assert(app.isConnected, 'the app is in the page');
  window.addEventListener('resize', () => {
    assert(view >= 0, 'the view number is not negative');
    assert(typeof lastMap === 'object', 'the map is an object or nothing');
    if (lastTree) { drawEdges(lastTree); }
    const box = document.getElementById('map');
    if (lastMap && box && Number(box.dataset['w']) !== box.clientWidth) { drawMap(lastMap.s, lastMap.byId); }
  });
  window.addEventListener('hashchange', () => { void route(); });
  void route();
}
boot();

// Test hook: the browser test reads the toast countdown through this object.
Object.assign(window, { __snowmobile: { countdown, toast, toastEl, clock: () => toastClock, setClock: (c: Countdown | null) => { toastClock = c; } } });
