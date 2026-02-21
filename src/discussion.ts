import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import { DiscussionState, DiscussionEntry, ParticipantId } from './types.js';

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

  const entryMarkdown = [
    `## Round ${entry.round} — ${entry.participant.toUpperCase()}`,
    `*${entry.timestamp}*`,
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
