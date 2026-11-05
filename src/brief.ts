import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';
import type { Finding, MachineResult } from './types.ts';

export interface BriefIdea {
  problem: string | null; evidence_url: string | null; conventional: string | null;
  gain_axis: string | null; gain: string | null; mismatch: string | null;
}

function briefHeadImpl(sm: BriefIdea): string {
  assert(typeof sm === 'object', 'the idea is an object');
  assert(Object.keys(sm).length >= 6, 'the idea has its six brief fields');
  if (!sm.problem) {
    return '';
  }
  const lines = [`**Problem:** ${sm.problem}`, `**Evidence:** ${String(sm.evidence_url)}`, `**Conventional solution:** ${String(sm.conventional)}`,
    `**Why better (${String(sm.gain_axis)}):** ${String(sm.gain)}`];
  if (sm.mismatch) {
    lines.push(`**Layer mismatch:** ${sm.mismatch}`);
  }
  assert(sm.problem.length > 0, 'the head starts with the problem');
  assert(lines.length >= 4, 'the head names the problem, the evidence, the solution and the gain');
  return `${lines.join('\n')}\n\n`;
}

export const briefHead = traced('brief.head', briefHeadImpl);

function faultText(findings: readonly Finding[]): string {
  assert(Number.isInteger(findings.length), 'findings come as a list');
  assert(findings.every((f) => f.kind.length > 0), 'a finding has a kind');
  assert(findings.length >= 0, 'findings are counted');
  assert(findings.length < 10 ** 6, 'findings are bounded');
  if (findings.length === 0) {
    return 'The check of the settled design found no fault.';
  }
  const plural = findings.length > 1 ? 's' : '';
  const lines = findings.map((f) => `- ${f.kind} ${f.machine} ${f.at}: ${f.detail}`);
  return `The check of the settled design found ${String(findings.length)} fault${plural}. The decisions above answer them. Build nothing that one of them contradicts.\n${lines.join('\n')}`;
}

function machineNotesImpl(machine: MachineResult | undefined): string {
  assert(machine === undefined || typeof machine === 'object', 'the machine result is an object or absent');
  assert(machine?.findings === undefined || Array.isArray(machine.findings), 'findings are a list or absent');
  if (!machine?.findings) {
    return '';
  }
  assert(machine.file.length >= 0, 'the machine file is text');
  return `\n\n## State machine\n\n${faultText(machine.findings)}\n\n\`\`\`\n${machine.file.trim()}\n\`\`\``;
}

export const machineNotes = traced('brief.machineNotes', machineNotesImpl);

function renderBriefImpl(head: BriefIdea, body: string, machine: MachineResult | undefined): string {
  assert(typeof body === 'string', 'the body is text');
  assert(body.length >= 0, 'the body has a length');
  assert(typeof head === 'object', 'the head is an object');
  assert(machine?.round === undefined || machine.round >= 0, 'a machine round is not negative');
  return briefHead(head) + body + machineNotes(machine);
}

export const renderBrief = traced('brief.render', renderBriefImpl);
