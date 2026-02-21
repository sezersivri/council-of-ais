import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import {
  DiscussionState,
  DiscussionEntry,
  ParticipantId,
  DecisionItem,
  ActionItem,
  RoundData,
} from './types.js';

export function initializeDiscussion(
  filePath: string,
  topic: string,
  participants: ParticipantId[],
): DiscussionState {
  const state: DiscussionState = {
    topic,
    participants,
    startedAt: new Date().toISOString(),
    entries: [],
    consensusStatus: 'emerging',
    finalPlan: null,
  };

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const header = [
    '# Multi-AI Discussion',
    '',
    `**Topic:** ${topic}`,
    `**Participants:** ${participants.map((p) => p.toUpperCase()).join(', ')}`,
    `**Started:** ${state.startedAt}`,
    '',
    '---',
    '',
  ].join('\n');

  writeFileSync(filePath, header, 'utf-8');
  return state;
}

export function appendEntry(
  filePath: string,
  state: DiscussionState,
  entry: DiscussionEntry,
): void {
  state.entries.push(entry);

  const signal = entry.parsedSections?.consensusSignal ?? 'UNKNOWN';
  const entryMarkdown = [
    `## Round ${entry.round} — ${entry.participant.toUpperCase()}`,
    `*${entry.timestamp}* | Signal: **${signal}**`,
    '',
    entry.rawResponse,
    '',
    '---',
    '',
  ].join('\n');

  appendFileSync(filePath, entryMarkdown, 'utf-8');
}

export function appendFinalPlan(
  filePath: string,
  state: DiscussionState,
  plan: string,
  consensusReached: boolean,
): void {
  state.finalPlan = plan;

  const section = [
    '',
    `# ${consensusReached ? 'Consensus Plan' : 'Summary (No Full Consensus)'}`,
    '',
    `*Generated at ${new Date().toISOString()}*`,
    '',
    plan,
    '',
  ].join('\n');

  appendFileSync(filePath, section, 'utf-8');
}

export function appendRichFooter(
  filePath: string,
  state: DiscussionState,
  roundData: RoundData[],
  durationMs: number,
  consensusReached: boolean,
  runId: string,
): void {
  const lines: string[] = ['', '---', '', '# Discussion Statistics', ''];

  // Summary block
  const rounds = roundData.length;
  const durationSec = (durationMs / 1000).toFixed(1);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Run ID | \`${runId}\` |`);
  lines.push(`| Total rounds | ${rounds} |`);
  lines.push(`| Duration | ${durationSec}s |`);
  lines.push(`| Consensus | ${consensusReached ? '✓ YES' : '✗ NO'} |`);
  lines.push('');

  // Consensus trajectory chart
  if (roundData.length > 0) {
    lines.push('## Consensus Trajectory');
    lines.push('');
    lines.push('```');
    for (const rd of roundData) {
      const signals = rd.entries.map((e) => {
        const s = e.parsedSections?.consensusSignal ?? '?';
        if (s === 'AGREE') return 'A';
        if (s === 'PARTIALLY_AGREE') return 'P';
        if (s === 'DISAGREE') return 'D';
        return '?';
      });
      const indicator = rd.consensusStatus === 'full' ? ' ✓' : '';
      lines.push(`R${rd.round}: [${signals.join('] [')}]${indicator}`);
    }
    lines.push('```');
    lines.push('');
    lines.push('Legend: A=AGREE  P=PARTIALLY_AGREE  D=DISAGREE');
    lines.push('');
  }

  // Per-round consensus status
  if (roundData.length > 0) {
    lines.push('## Round Summary');
    lines.push('');
    lines.push('| Round | Participants | Consensus Status | Duration |');
    lines.push('|-------|-------------|-----------------|----------|');
    for (const rd of roundData) {
      const participants = rd.entries.map((e) => e.participant).join(', ');
      const durationStr = `${(rd.durationMs / 1000).toFixed(1)}s`;
      lines.push(`| ${rd.round} | ${participants} | ${rd.consensusStatus} | ${durationStr} |`);
    }
    lines.push('');
  }

  // Final proposals side-by-side
  const lastRound = roundData[roundData.length - 1];
  if (lastRound && lastRound.entries.some((e) => e.parsedSections?.proposal)) {
    lines.push('## Final Proposals');
    lines.push('');
    for (const entry of lastRound.entries) {
      const proposal = entry.parsedSections?.proposal?.trim();
      if (proposal) {
        lines.push(`### ${entry.participant.toUpperCase()}`);
        lines.push('');
        lines.push(proposal);
        lines.push('');
      }
    }
  }

  // Table of contents (appended at bottom)
  lines.push('## Table of Contents');
  lines.push('');
  const rounds2 = new Set(state.entries.map((e) => e.round));
  for (const r of Array.from(rounds2).sort((a, b) => a - b)) {
    const roundEntries = state.entries.filter((e) => e.round === r);
    for (const e of roundEntries) {
      lines.push(`- [Round ${r} — ${e.participant.toUpperCase()}](#round-${r}--${e.participant})`);
    }
  }
  lines.push('');

  appendFileSync(filePath, lines.join('\n'), 'utf-8');
}

export function saveStateJson(
  filePath: string,
  state: DiscussionState,
  sessionMap: Map<ParticipantId, string | undefined>,
  roundTimings?: Map<string, number>,
): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sessions: Record<string, string | undefined> = {};
  for (const [pid, sid] of sessionMap) {
    sessions[pid] = sid;
  }

  const timings: Record<string, number> | undefined = roundTimings
    ? Object.fromEntries(roundTimings)
    : undefined;

  const json = {
    ...state,
    sessions,
    ...(timings && { roundTimings: timings }),
    savedAt: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
}

export function getLatestEntriesPerParticipant(
  state: DiscussionState,
  round: number,
): Map<ParticipantId, DiscussionEntry> {
  const latest = new Map<ParticipantId, DiscussionEntry>();
  for (const entry of state.entries) {
    if (entry.round === round) {
      latest.set(entry.participant, entry);
    }
  }
  return latest;
}

/**
 * Best-effort extraction of decision items from the final summary text.
 * Looks for lines like "**Decision:** X" or items under a "## Decisions" section.
 */
export function extractDecisions(text: string, round: number): DecisionItem[] {
  const decisions: DecisionItem[] = [];

  // Look for explicit decision markers
  const decisionRegex = /(?:^|\n)\s*[-*]?\s*\*\*Decision:\*\*\s*(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = decisionRegex.exec(text)) !== null) {
    decisions.push({ decision: match[1].trim(), status: 'accepted', round });
  }

  if (decisions.length > 0) return decisions;

  // Look for a Decisions section
  const sectionMatch = /(?:^|\n)#{1,3}\s+Decisions?\s*\n([\s\S]+?)(?=\n#{1,3}|\n#|$)/i.exec(text);
  if (sectionMatch) {
    const items = sectionMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 0);
    for (const item of items) {
      decisions.push({ decision: item, status: 'open', round });
    }
  }

  return decisions;
}

/**
 * Best-effort extraction of action items from the final summary text.
 * Looks for checkbox lines "- [ ] X" or items under an "## Action Items" section.
 */
export function extractActionItems(text: string): ActionItem[] {
  const items: ActionItem[] = [];

  // Look for checkbox-style action items: "- [ ] X (priority: HIGH)"
  const checkboxRegex = /(?:^|\n)\s*-\s+\[[ x]\]\s+(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = checkboxRegex.exec(text)) !== null) {
    const raw = match[1].trim();
    const priorityMatch = /\(priority:\s*(\w+)\)/i.exec(raw);
    const priority = priorityMatch ? priorityMatch[1].toUpperCase() : 'MEDIUM';
    const item = raw.replace(/\(priority:\s*\w+\)/i, '').trim();
    items.push({ item, priority, rationale: '' });
  }

  if (items.length > 0) return items;

  // Look for an Action Items section
  const sectionMatch = /(?:^|\n)#{1,3}\s+Action Items?\s*\n([\s\S]+?)(?=\n#{1,3}|\n#|$)/i.exec(text);
  if (sectionMatch) {
    const lines = sectionMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      items.push({ item: line, priority: 'MEDIUM', rationale: '' });
    }
  }

  return items;
}
