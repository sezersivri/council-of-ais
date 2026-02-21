import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DiscussionState, DiscussionEntry, ParticipantId, ParticipantConfig } from './types.js';
import { getLatestEntriesPerParticipant } from './discussion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const PARTICIPANT_NAMES: Record<ParticipantId, string> = {
  claude: 'Claude (Anthropic)',
  codex: 'Codex (OpenAI)',
  gemini: 'Gemini (Google)',
};

export function buildInitialPrompt(
  topic: string,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  role?: string,
): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'initial-prompt.md'), 'utf-8');

  const roleText = role
    ? `\nYour assigned role is: **${role}**. Approach the discussion from this perspective.`
    : '';

  return template
    .replace(/\{\{PARTICIPANT_NAME\}\}/g, PARTICIPANT_NAMES[participantId])
    .replace(/\{\{TOPIC\}\}/g, topic)
    .replace(/\{\{ROLE\}\}/g, roleText)
    .replace(/\{\{ROUND_NUMBER\}\}/g, String(roundNumber))
    .replace(/\{\{MAX_ROUNDS\}\}/g, String(maxRounds));
}

const CATCH_UP_FORMAT_RULES = `\
Use EXACTLY these three sections:

### Substance
Your position, reasoning, and concrete plan. No preamble.

### Deltas
None (or +/-/~ bullets if you have position changes)

### Consensus Signal
Write exactly one of: \`AGREE\`, \`PARTIALLY_AGREE\`, or \`DISAGREE\` on its own line.`;

export function buildRoundPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
  isFreshSession?: boolean,
): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'round-prompt.md'), 'utf-8');

  // Get other participants' responses from the previous round.
  // Context reduction: pass only proposal + agreement/disagreement points
  // instead of full raw responses, to cut token costs and keep AIs focused.
  const previousRound = roundNumber - 1;
  const latestEntries = getLatestEntriesPerParticipant(state, previousRound);

  const otherResponses: string[] = [];
  for (const [pid, entry] of latestEntries) {
    if (pid !== participantId) {
      otherResponses.push(formatEntryForDelta(pid, entry));
    }
  }

  const otherResponsesText = otherResponses.length > 0
    ? otherResponses.join('\n\n---\n\n')
    : '*No responses from other participants yet.*';

  const guidanceText = userGuidance
    ? `**User guidance for this round:** ${userGuidance}\n\n`
    : '';

  // Round 3+: inject convergence pressure instruction into Substance
  const convergenceInstruction = roundNumber >= 3
    ? '**First line must be:** `Merging with @Agent` or `Holding: [one-sentence reason]`\n'
    : '';

  const roundPrompt = template
    .replace(/\{\{ROUND_NUMBER\}\}/g, String(roundNumber))
    .replace(/\{\{MAX_ROUNDS\}\}/g, String(maxRounds))
    .replace(/\{\{OTHER_RESPONSES\}\}/g, otherResponsesText)
    .replace(/\{\{USER_GUIDANCE\}\}/g, guidanceText)
    .replace(/\{\{CONVERGENCE_INSTRUCTION\}\}/g, convergenceInstruction);

  // Item 9: prepend catch-up context for participants rejoining after a session reset
  if (isFreshSession && roundNumber > 1) {
    const catchUp = [
      '## Catch-Up Context (you rejoined mid-discussion)',
      '',
      `**Original Topic (summary):** ${state.topic.slice(0, 500)}`,
      '',
      '**Format rules:**',
      CATCH_UP_FORMAT_RULES,
      '',
      '**What others proposed last round:**',
      otherResponsesText,
      '',
      '---',
      'Now continue with this round\'s delta:',
      '',
    ].join('\n');
    return catchUp + roundPrompt;
  }

  return roundPrompt;
}

/**
 * Format a discussion entry for inclusion in a round delta prompt.
 * Context reduction: sends substance + deltas only, not full raw response.
 */
function formatEntryForDelta(pid: ParticipantId, entry: DiscussionEntry): string {
  if (entry.parsedSections) {
    const s = entry.parsedSections;
    const parts: string[] = [`### ${PARTICIPANT_NAMES[pid]}:`];

    // New format: substance field; old format: proposal || analysis
    const content = s.substance || s.proposal || s.analysis;
    if (content) {
      parts.push(`\n**Substance:** ${content}`);
    }

    // New format: deltas; old format: agreement/disagreement bullets
    if (s.deltas && s.deltas.length > 0) {
      parts.push(`\n**Deltas:**\n${s.deltas.map((d) => `- ${d}`).join('\n')}`);
    } else {
      if (s.pointsOfAgreement.length > 0) {
        parts.push(`\n**Agreed:**\n${s.pointsOfAgreement.map((p) => `- ${p}`).join('\n')}`);
      }
      if (s.pointsOfDisagreement.length > 0) {
        parts.push(`\n**Disagreed:**\n${s.pointsOfDisagreement.map((p) => `- ${p}`).join('\n')}`);
      }
    }

    parts.push(`\n**Signal:** ${s.consensusSignal}`);
    return parts.join('\n');
  }

  // Fallback to raw response if parsing failed
  return `### ${PARTICIPANT_NAMES[pid]}:\n\n${entry.rawResponse}`;
}

export function buildTieBreakerLeadPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'tiebreaker-lead-prompt.md'), 'utf-8');

  const previousRound = roundNumber - 1;
  const latestEntries = getLatestEntriesPerParticipant(state, previousRound);

  const otherResponses: string[] = [];
  for (const [pid, entry] of latestEntries) {
    if (pid !== participantId) {
      otherResponses.push(formatEntryForDelta(pid, entry));
    }
  }

  const otherResponsesText = otherResponses.length > 0
    ? otherResponses.join('\n\n---\n\n')
    : '*No responses from other participants yet.*';

  const guidanceText = userGuidance
    ? `**User guidance for this round:** ${userGuidance}\n\n`
    : '';

  return template
    .replace(/\{\{ROUNDS_ELAPSED\}\}/g, String(previousRound))
    .replace(/\{\{OTHER_RESPONSES\}\}/g, otherResponsesText)
    .replace(/\{\{USER_GUIDANCE\}\}/g, guidanceText);
}

export function buildTieBreakerFollowPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  leadId: ParticipantId,
  roundNumber: number,
  _maxRounds: number,
  userGuidance?: string,
): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'tiebreaker-follow-prompt.md'), 'utf-8');

  const previousRound = roundNumber - 1;
  const latestEntries = getLatestEntriesPerParticipant(state, previousRound);

  // Extract the lead's response from the previous round
  const leadEntry = latestEntries.get(leadId);
  const leadResponseText = leadEntry
    ? formatEntryForDelta(leadId, leadEntry)
    : '*Lead Architect did not respond in the previous round.*';

  // Collect other (non-lead, non-self) responses
  const otherResponses: string[] = [];
  for (const [pid, entry] of latestEntries) {
    if (pid !== participantId && pid !== leadId) {
      otherResponses.push(formatEntryForDelta(pid, entry));
    }
  }

  const otherResponsesSection = otherResponses.length > 0
    ? `Here is what other participants said:\n\n${otherResponses.join('\n\n---\n\n')}`
    : '';

  const guidanceText = userGuidance
    ? `**User guidance for this round:** ${userGuidance}\n\n`
    : '';

  return template
    .replace(/\{\{LEAD_NAME\}\}/g, PARTICIPANT_NAMES[leadId])
    .replace(/\{\{LEAD_RESPONSE\}\}/g, leadResponseText)
    .replace(/\{\{OTHER_RESPONSES_SECTION\}\}/g, otherResponsesSection + (guidanceText ? '\n\n' + guidanceText : ''));
}

export function buildFinalSummaryPrompt(state: DiscussionState): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'final-summary-prompt.md'), 'utf-8');

  const maxRound = state.entries.length > 0
    ? Math.max(...state.entries.map((e) => e.round))
    : 0;

  return template
    .replace(/\{\{TOPIC\}\}/g, state.topic)
    .replace(/\{\{TOTAL_ROUNDS\}\}/g, String(maxRound))
    .replace(/\{\{PARTICIPANT_COUNT\}\}/g, String(state.participants.length));
}
