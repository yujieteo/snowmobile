export type Table<S extends string, E extends string> = { readonly [s in S]: { readonly [e in E]?: S | '-' } };

export interface Machine<S extends string, E extends string> {
  readonly name: string;
  readonly initial: S;
  readonly table: Table<S, E>;
}

export class RefusedTransition extends Error {
  readonly machine: string;
  readonly state: string;
  readonly event: string;
  constructor(machine: string, state: string, event: string) {
    super(`${machine}: the event "${event}" is refused in the state "${state}"`);
    this.name = 'RefusedTransition';
    this.machine = machine;
    this.state = state;
    this.event = event;
  }
}

export function next<S extends string, E extends string>(m: Machine<S, E>, state: S, event: E): S {
  const to = (m.table[state] as { readonly [e in E]?: S | '-' })[event];
  if (to === undefined) throw new RefusedTransition(m.name, state, event);
  return to === '-' ? state : (to as S);
}

export function allows<S extends string, E extends string>(m: Machine<S, E>, state: S, event: E): boolean {
  return (m.table[state] as { readonly [e in E]?: S | '-' })[event] !== undefined;
}

export function rowsOf<S extends string, E extends string>(m: Machine<S, E>): [S, E, S | '-'][] {
  return (Object.keys(m.table) as S[]).flatMap((s) =>
    (Object.entries(m.table[s]) as [E, S | '-'][]).map(([e, to]): [S, E, S | '-'] => [s, e, to]));
}

export interface Cell<S extends string, E extends string> {
  readonly machine: Machine<S, E>;
  readonly state: S;
  send(event: E): boolean;
}

export function cell<S extends string, E extends string>(machine: Machine<S, E>): Cell<S, E> {
  let state = machine.initial;
  return {
    machine,
    get state() { return state; },
    send(event) {
      if (!allows(machine, state, event)) return false;
      const to = next(machine, state, event);
      const moved = (machine.table[state] as { readonly [e in E]?: S | '-' })[event] !== '-';
      state = to;
      return moved;
    },
  };
}
