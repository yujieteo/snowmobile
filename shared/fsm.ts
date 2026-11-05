import { assert } from './assert.ts';

export type Table<S extends string, E extends string> = Readonly<Record<S, Readonly<Partial<Record<E, S | '-'>>>>>;

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
    assert(machine.length > 0, 'a machine has a name');
    assert(event.length > 0, 'an event has a name');
    super(`${machine}: the event "${event}" is refused in the state "${state}"`);
    this.name = 'RefusedTransition';
    this.machine = machine;
    this.state = state;
    this.event = event;
  }
}

type Row<S extends string, E extends string> = Readonly<Partial<Record<E, S | '-'>>>;

function rowOf<S extends string, E extends string>(m: Machine<S, E>, state: S): Row<S, E> {
  const row = (m.table as Record<string, Row<S, E> | undefined>)[state];
  assert(m.name.length > 0, 'a machine has a name');
  assert(row !== undefined, 'the state is a row of the table');
  return row;
}

export function next<S extends string, E extends string>(m: Machine<S, E>, state: S, event: E): S {
  assert(state.length > 0, 'a state has a name');
  assert(event.length > 0, 'an event has a name');
  const to = rowOf(m, state)[event];
  if (to === undefined) {
    throw new RefusedTransition(m.name, state, event);
  }
  return to === '-' ? state : (to as S);
}

export function allows<S extends string, E extends string>(m: Machine<S, E>, state: S, event: E): boolean {
  assert(state.length > 0, 'a state has a name');
  assert(event.length > 0, 'an event has a name');
  return rowOf(m, state)[event] !== undefined;
}

export function rowsOf<S extends string, E extends string>(m: Machine<S, E>): [S, E, S | '-'][] {
  assert(m.name.length > 0, 'a machine has a name');
  assert(Object.keys(m.table).length > 0, 'a machine has states');
  const rows: [S, E, S | '-'][] = [];
  for (const s of Object.keys(m.table) as S[]) {
    for (const [e, to] of Object.entries(rowOf(m, s)) as [E, S | '-'][]) {
      rows.push([s, e, to]);
    }
  }
  return rows;
}

export interface Cell<S extends string, E extends string> {
  readonly machine: Machine<S, E>;
  readonly state: S;
  send(event: E): boolean;
}

function sendTo<S extends string, E extends string>(machine: Machine<S, E>, state: S, event: E): { moved: boolean; to: S } | null {
  assert(event.length > 0, 'an event has a name');
  assert(state.length > 0, 'a state has a name');
  if (!allows(machine, state, event)) {
    return null;
  }
  return { to: next(machine, state, event), moved: rowOf(machine, state)[event] !== '-' };
}

export function cell<S extends string, E extends string>(machine: Machine<S, E>): Cell<S, E> {
  assert(machine.initial.length > 0, 'a machine starts in a named state');
  assert(machine.name.length > 0, 'a machine has a name');
  let state = machine.initial;
  return {
    machine,
    get state() {
      assert(state.length > 0, 'the cell is in a named state');
      return state;
    },
    send(event) {
      assert(event.length > 0, 'an event has a name');
      const step = sendTo(machine, state, event);
      assert(step === null || step.to.length > 0, 'a step lands in a named state');
      if (!step) {
        return false;
      }
      state = step.to;
      return step.moved;
    },
  };
}
