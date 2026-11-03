import { traced } from './trace.ts';

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = traced('page.esc', (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITY[c] ?? c));

export const md = traced('page.md', (s: string): string =>
  esc(s).split('\n').map((l) => {
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) return `<b style="font-size:${20 - (h[1]?.length ?? 0) * 1.5}px">${h[2]}</b>`;
    return l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }).join('\n'));

export function plural(n: number, one: string, other: string): string {
  return `${n} ${new Intl.PluralRules('en').select(n) === 'one' ? one : other}`;
}

export const link = (url: string | null | undefined, text: unknown): string =>
  /^https?:\/\//i.test(url || '') ? `<a class="src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
