import { DiscussionState, QualityGate } from './types.js';

/**
 * Evaluate the structural quality gate using existing parsed data — no LLM judge.
 *
 * pass  — majority/lead AGREE + non-empty final Proposal
 * warn  — PARTIALLY_AGREE majority OR max rounds reached
 * fail  — DISAGREE majority OR parse errors dominate the final round
 */
export function evaluateQualityGate(
  state: DiscussionState,
  consensusReached: boolean,
  maxRoundsReached: boolean,
): QualityGate {
  const maxRound = state.entries.reduce((m, e) => Math.max(m, e.round), 0);
  const finalEntries = state.entries.filter((e) => e.round === maxRound);

  if (finalEntries.length === 0) return 'fail';

  const parseErrors = finalEntries.filter((e) => !e.parsedSections).length;
  const signals = finalEntries
    .map((e) => e.parsedSections?.consensusSignal)
    .filter((s): s is NonNullable<typeof s> => !!s);

  const disagreeCount = signals.filter((s) => s === 'DISAGREE').length;
  const partialCount = signals.filter((s) => s === 'PARTIALLY_AGREE').length;
  const hasNonEmptyProposal = finalEntries.some(
    (e) => (e.parsedSections?.proposal ?? '').trim().length > 0,
  );

  // fail: DISAGREE majority OR parse errors dominate
  if (
    parseErrors > finalEntries.length / 2 ||
    (signals.length > 0 && disagreeCount > signals.length / 2)
  ) {
    return 'fail';
  }

  // pass: full consensus reached + non-empty final proposal
  if (consensusReached && hasNonEmptyProposal) {
    return 'pass';
  }

  // warn: PARTIALLY_AGREE majority OR max rounds reached
  if (maxRoundsReached || (signals.length > 0 && partialCount > signals.length / 2)) {
    return 'warn';
  }

  return 'warn';
}
