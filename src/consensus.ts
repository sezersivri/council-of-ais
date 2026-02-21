import { DiscussionState, ConsensusStatus, ResponseSections, ConsensusSignal, ParticipantId } from './types.js';

/**
 * Build a regex that matches a section header in multiple formats LLMs may use:
 * - #{1,6} heading levels (##, ###, ####, etc.)
 * - **Bold** style headers
 * - Optional trailing colon
 * - Optional newline after header
 */
function sectionRegex(name: string): RegExp {
  return new RegExp(
    `(?:#{1,6}\\s*${name}|\\*\\*${name}\\*\\*)\\s*:?[ \\t]*\\n?([\\s\\S]*?)(?=#{1,6}\\s|\\*\\*(?:Analysis|Points|Proposal|Consensus|Substance|Deltas|Decision)\\b|$)`,
    'i',
  );
}

function parseSignal(rawResponse: string): ConsensusSignal {
  const signalMatch = rawResponse.match(sectionRegex('Consensus Signal'));
  const signalText = signalMatch?.[1]?.trim() || '';
  if (/\bPARTIALLY_AGREE\b/i.test(signalText) || /\bPARTIALLY AGREE\b/i.test(signalText)) {
    return 'PARTIALLY_AGREE';
  }
  if (/\bAGREE\b/.test(signalText) && !/\bDISAGREE\b/.test(signalText)) {
    return 'AGREE';
  }
  return 'DISAGREE';
}

function parseDeltaBullets(text: string): string[] {
  if (!text || /^\s*none\s*$/i.test(text.trim())) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[+\-~`]/.test(line) || /^[-*]/.test(line))
    .map((line) => line.replace(/^[-*`]\s*/, '').trim())
    .filter(Boolean);
}

const extractBullets = (text: string | undefined): string[] => {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]/.test(line) || /^\d+\./.test(line))
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, ''));
};

export function parseResponseSections(rawResponse: string): ResponseSections | null {
  try {
    const consensusSignal = parseSignal(rawResponse);

    // Try new High-Signal format first (Substance / Deltas / Consensus Signal)
    const substanceMatch = rawResponse.match(sectionRegex('Substance'));
    if (substanceMatch) {
      const substance = substanceMatch[1]?.trim() || '';
      const deltasMatch = rawResponse.match(sectionRegex('Deltas'));
      const deltasRaw = deltasMatch?.[1]?.trim() || '';
      const deltas = parseDeltaBullets(deltasRaw);

      // Extract convergence statement from first non-empty line of Substance
      const firstLine = substance.split('\n').find((l) => l.trim())?.trim() ?? '';
      const convergence = /^(Merging with|Holding:|MERGE WITH|HOLD\b)/i.test(firstLine)
        ? firstLine
        : null;

      return {
        substance,
        deltas,
        convergence,
        // Legacy compat — map new fields onto old ones so existing code keeps working
        analysis: substance,
        proposal: substance,
        pointsOfAgreement: deltas
          .filter((d) => /^\+/.test(d))
          .map((d) => d.replace(/^\+\s*(adopted:)?\s*/i, '')),
        pointsOfDisagreement: deltas
          .filter((d) => /^-/.test(d))
          .map((d) => d.replace(/^-\s*(reject:)?\s*/i, '')),
        consensusSignal,
      };
    }

    // Fall back to old format (Analysis / Points of Agreement / Points of Disagreement / Proposal / Consensus Signal)
    const analysisMatch = rawResponse.match(sectionRegex('Analysis'));
    const agreeMatch = rawResponse.match(sectionRegex('Points of Agreement'));
    const disagreeMatch = rawResponse.match(sectionRegex('Points of Disagreement'));
    const proposalMatch = rawResponse.match(sectionRegex('Proposal'));

    const analysis = analysisMatch?.[1]?.trim() || '';
    const proposal = proposalMatch?.[1]?.trim() || '';

    return {
      substance: proposal || analysis,
      deltas: [],
      convergence: null,
      analysis,
      proposal,
      pointsOfAgreement: extractBullets(agreeMatch?.[1]),
      pointsOfDisagreement: extractBullets(disagreeMatch?.[1]),
      consensusSignal,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a fenced code block from a "Code Artifact" section in the response.
 * Returns the code and detected language, or null if no artifact found.
 */
export function extractCodeArtifact(rawResponse: string): { code: string; language: string } | null {
  const match = rawResponse.match(
    /(?:#{1,6}\s*Code Artifact|\*\*Code Artifact\*\*)\s*:?\s*\n[\s\S]*?```(\w*)\n([\s\S]*?)```/i,
  );
  if (!match) return null;
  const language = match[1] || 'typescript';
  const code = match[2]?.trim();
  return code ? { code, language } : null;
}

export function detectConsensus(
  state: DiscussionState,
  requiredConsecutiveAgrees: number = 1,
): ConsensusStatus {
  const maxRound = state.entries.length > 0
    ? Math.max(...state.entries.map((e) => e.round))
    : 0;

  if (maxRound === 0) return 'emerging';

  // Count signals from participants who actually responded this round
  const latestSignals = new Map<ParticipantId, ConsensusSignal>();
  for (const entry of state.entries) {
    if (entry.round === maxRound && entry.parsedSections) {
      latestSignals.set(entry.participant, entry.parsedSections.consensusSignal);
    }
  }

  const respondedCount = latestSignals.size;

  // Need at least 2 respondents to evaluate consensus
  if (respondedCount < 2) {
    return 'emerging';
  }

  const signals = Array.from(latestSignals.values());
  const agreeCount = signals.filter((s) => s === 'AGREE').length;
  const partialCount = signals.filter((s) => s === 'PARTIALLY_AGREE').length;

  // Full consensus: all respondents agree (handles partial failures gracefully)
  if (agreeCount === respondedCount) {
    if (requiredConsecutiveAgrees > 1) {
      return checkConsecutiveConsensus(state, requiredConsecutiveAgrees)
        ? 'full'
        : 'emerging';
    }
    return 'full';
  }

  // Partial: supermajority agrees or partially agrees
  if ((agreeCount + partialCount) >= Math.ceil(respondedCount * 0.66)) {
    return 'partial';
  }

  if (agreeCount > 0 || partialCount > 0) {
    return 'emerging';
  }

  return 'disagreement';
}

function checkConsecutiveConsensus(
  state: DiscussionState,
  requiredRounds: number,
): boolean {
  const maxRound = Math.max(...state.entries.map((e) => e.round));

  for (let r = maxRound; r > maxRound - requiredRounds; r--) {
    if (r < 1) return false;
    const roundEntries = state.entries.filter((e) => e.round === r);
    if (roundEntries.length < 2) return false;
    const allAgree = roundEntries.every(
      (e) => e.parsedSections?.consensusSignal === 'AGREE',
    );
    if (!allAgree) return false;
  }

  return true;
}
