import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DiscussionState, DiscussionEntry, ParticipantId, ParticipantConfig } from './types.js';
import { getLatestEntriesPerParticipant } from './discussion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const BUILTIN_NAMES: Record<string, string> = {
  claude: 'Claude (Anthropic)',
  codex: 'Codex (OpenAI)',
  gemini: 'Gemini (Google)',
};

function getParticipantName(id: ParticipantId): string {
  return BUILTIN_NAMES[id] ?? id;
}

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
    .replace(/\{\{PARTICIPANT_NAME\}\}/g, getParticipantName(participantId))
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
If you agree, write: \`AGREE_WITH_RESERVATION: [≥20 words naming a specific concern or failure mode]\`
Otherwise write \`PARTIALLY_AGREE\` or \`DISAGREE\`.
(Bare \`AGREE\` is also accepted for backward compatibility.)`;

/**
 * Build a blind draft prompt for the independent-draft sub-round.
 * Participants write their position without seeing peer responses.
 */
export function buildBlindDraftPrompt(
  topic: string,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
): string {
  const guidanceText = userGuidance ? `\n\n**Project guidance:** ${userGuidance}` : '';
  return [
    `Round ${roundNumber} of ${maxRounds} — Blind Draft Phase.`,
    '',
    `**Topic:** ${topic.slice(0, 300)}`,
    '',
    "Without seeing peers' responses, state your current position in 150 words or less.",
    'Write ONLY a `### Substance` section. No Deltas. No Consensus Signal.',
    guidanceText,
  ].filter(Boolean).join('\n');
}

export function buildRoundPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
  isFreshSession?: boolean,
  blindDraft?: string,
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

  const blindDraftPrefix = blindDraft
    ? `**Your blind draft (do not change your core position, only integrate peer feedback):**\n${blindDraft}\n\n`
    : '';

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
    return blindDraftPrefix + catchUp + roundPrompt;
  }

  return blindDraftPrefix + roundPrompt;
}

/**
 * Format a discussion entry for inclusion in a round delta prompt.
 * Context reduction: sends substance + deltas only, not full raw response.
 */
function formatEntryForDelta(pid: ParticipantId, entry: DiscussionEntry): string {
  if (entry.parsedSections) {
    const s = entry.parsedSections;
    const parts: string[] = [`### ${getParticipantName(pid)}:`];

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
  return `### ${getParticipantName(pid)}:\n\n${entry.rawResponse}`;
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
    .replace(/\{\{LEAD_NAME\}\}/g, getParticipantName(leadId))
    .replace(/\{\{LEAD_RESPONSE\}\}/g, leadResponseText)
    .replace(/\{\{OTHER_RESPONSES_SECTION\}\}/g, otherResponsesSection + (guidanceText ? '\n\n' + guidanceText : ''));
}

/**
 * Build a round prompt for stateless participants.
 * Prepends full context (topic + consensus status + compressed history + delta)
 * so the participant can respond meaningfully without any session memory.
 */
export function buildStatelessRoundPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
  blindDraft?: string,
): string {
  // Compress previous rounds into one line each
  const historyLines: string[] = [];
  for (let r = 1; r < roundNumber; r++) {
    const roundEntries = state.entries.filter((e) => e.round === r);
    if (roundEntries.length === 0) continue;
    const summaries = roundEntries.map((e) => {
      const substance =
        e.parsedSections?.substance ||
        e.parsedSections?.proposal ||
        e.rawResponse.slice(0, 200);
      return `${e.participant.toUpperCase()}: ${substance.slice(0, 150).replace(/\n+/g, ' ')}`;
    });
    historyLines.push(`**Round ${r}:** ${summaries.join(' | ')}`);
  }
  const historyText =
    historyLines.length > 0 ? historyLines.join('\n') : '*No previous rounds.*';

  // Build the standard delta prompt (what others said last round)
  const deltaPrompt = buildRoundPrompt(state, participantId, roundNumber, maxRounds, userGuidance, false, blindDraft);

  const contextHeader = [
    '## Full Discussion Context',
    '*(You have no session memory — this block contains everything you need.)*',
    '',
    `**Topic:** ${state.topic}`,
    `**Round:** ${roundNumber} of ${maxRounds}`,
    `**Consensus Status:** ${state.consensusStatus}`,
    '',
    '**Discussion History:**',
    historyText,
    '',
    '---',
    '',
  ].join('\n');

  return contextHeader + deltaPrompt;
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
