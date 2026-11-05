import { assert } from './assert.ts';
import { traced } from './trace.ts';

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escImpl(s: unknown): string {
  assert(Object.keys(ENTITY).length === 5, 'five characters are escaped');
  assert(typeof s !== 'function', 'a function is not text');
  // Any value is shown the way String() shows it: an array as its items, an object as [object Object].
  const text = ''.concat((s ?? '') as string);
  const escaped = text.replace(/[&<>"']/g, (c) => ENTITY[c] ?? c);
  assert(!/[<>]/.test(escaped), 'no angle bracket is left');
  assert(escaped.length >= text.length, 'escaping never shortens text');
  return escaped;
}

export const esc = traced('page.esc', escImpl);

function mdLine(l: string): string {
  assert(typeof l === 'string', 'a line is text');
  assert(!l.includes('\n'), 'a line has no line break');
  const h = /^(#{1,4})\s+(.*)/.exec(l);
  if (h) {
    return `<b style="font-size:${String(20 - (h[1]?.length ?? 0) * 1.5)}px">${h[2] ?? ''}</b>`;
  }
  return l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

function mdImpl(s: string): string {
  assert(typeof s === 'string', 'markdown is text');
  assert(s.length < 10 ** 7, 'markdown is bounded');
  const lines = esc(s).split('\n').map(mdLine);
  assert(lines.length >= 1, 'a text has at least one line');
  assert(lines.length === s.split('\n').length, 'lines are kept');
  return lines.join('\n');
}

export const md = traced('page.md', mdImpl);

export function plural(n: number, one: string, other: string): string {
  assert(Number.isFinite(n), 'a count is a number');
  assert(one.length > 0 && other.length > 0, 'both forms are given');
  assert(Number.isInteger(n) || !Number.isNaN(n), 'a count is a number');
  return `${String(n)} ${new Intl.PluralRules('en').select(n) === 'one' ? one : other}`;
}

function linkImpl(url: string | null | undefined, text: unknown): string {
  assert(url === null || url === undefined || typeof url === 'string', 'a url is text or absent');
  assert(typeof text !== 'symbol', 'a symbol is not text');
  return /^https?:\/\//i.test(url ?? '') ? `<a class="src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
}

export const link = linkImpl;
