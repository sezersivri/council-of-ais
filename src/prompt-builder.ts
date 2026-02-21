import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DiscussionState, ParticipantId, ParticipantConfig } from './types.js';
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

export function buildRoundPrompt(
  state: DiscussionState,
  participantId: ParticipantId,
  roundNumber: number,
  maxRounds: number,
  userGuidance?: string,
): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'round-prompt.md'), 'utf-8');

  // Get other participants' responses from the previous round
  const previousRound = roundNumber - 1;
  const latestEntries = getLatestEntriesPerParticipant(state, previousRound);

  const otherResponses: string[] = [];
  for (const [pid, entry] of latestEntries) {
    if (pid !== participantId) {
      otherResponses.push(
        `### ${PARTICIPANT_NAMES[pid]}:\n\n${entry.rawResponse}`,
      );
    }
  }

  const otherResponsesText = otherResponses.length > 0
    ? otherResponses.join('\n\n---\n\n')
    : '*No responses from other participants yet.*';

  const guidanceText = userGuidance
    ? `**User guidance for this round:** ${userGuidance}\n\n`
    : '';

  return template
    .replace(/\{\{ROUND_NUMBER\}\}/g, String(roundNumber))
    .replace(/\{\{MAX_ROUNDS\}\}/g, String(maxRounds))
    .replace(/\{\{OTHER_RESPONSES\}\}/g, otherResponsesText)
    .replace(/\{\{USER_GUIDANCE\}\}/g, guidanceText);
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
