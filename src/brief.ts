import { traced } from '../shared/trace.ts';
import type { MachineResult } from './types.ts';

export interface BriefIdea {
  problem: string | null; evidence_url: string | null; conventional: string | null;
  gain_axis: string | null; gain: string | null; mismatch: string | null;
}

export const briefHead = traced('brief.head', (sm: BriefIdea): string => {
  if (!sm.problem) return '';
  return [`**Problem:** ${sm.problem}`, `**Evidence:** ${sm.evidence_url}`, `**Conventional solution:** ${sm.conventional}`,
    `**Why better (${sm.gain_axis}):** ${sm.gain}`, ...(sm.mismatch ? [`**Layer mismatch:** ${sm.mismatch}`] : [])].join('\n') + '\n\n';
});

export const machineNotes = traced('brief.machineNotes', (machine: MachineResult | undefined): string => {
  if (!machine || !machine.findings) return '';
  const faults = machine.findings.length
    ? `The check of the settled design found ${machine.findings.length} fault${machine.findings.length > 1 ? 's' : ''}. The decisions above answer them. Build nothing that one of them contradicts.\n${machine.findings.map((f) => `- ${f.kind} ${f.machine} ${f.at}: ${f.detail}`).join('\n')}`
    : 'The check of the settled design found no fault.';
  return `\n\n## State machine\n\n${faults}\n\n\`\`\`\n${machine.file.trim()}\n\`\`\``;
});

export const renderBrief = traced('brief.render', (head: BriefIdea, body: string, machine: MachineResult | undefined): string =>
  briefHead(head) + body + machineNotes(machine));
