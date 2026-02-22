import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponseSections, extractCodeArtifact, detectConsensus, isDeltasConverged, extractReservations } from '../src/consensus.js';
import type { DiscussionState, DiscussionEntry, ConsensusSignal, ResponseSections } from '../src/types.js';

function makeEntry(
  round: number,
  participant: 'claude' | 'codex' | 'gemini',
  signal: ConsensusSignal,
  hasParsedSections = true,
): DiscussionEntry {
  return {
    round,
    participant,
    timestamp: new Date().toISOString(),
    rawResponse: '',
    parsedSections: hasParsedSections
      ? { analysis: '', pointsOfAgreement: [], pointsOfDisagreement: [], proposal: '', consensusSignal: signal }
      : null,
  };
}

function makeState(entries: DiscussionEntry[]): DiscussionState {
  return {
    topic: 'test topic',
    participants: ['claude', 'codex', 'gemini'],
    startedAt: new Date().toISOString(),
    entries,
    consensusStatus: 'emerging',
    finalPlan: null,
  };
}

// ---------------------------------------------------------------------------
// parseResponseSections
// ---------------------------------------------------------------------------
describe('parseResponseSections', () => {
  test('parses ## heading format with all sections', () => {
    const raw = [
      '## Analysis',
      'This is my analysis.',
      '## Points of Agreement',
      '- Point one',
      '- Point two',
      '## Points of Disagreement',
      '- Concern',
      '## Proposal',
      'Use microservices.',
      '## Consensus Signal',
      'AGREE',
    ].join('\n');

    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.analysis, 'This is my analysis.');
    assert.deepEqual(result.pointsOfAgreement, ['Point one', 'Point two']);
    assert.deepEqual(result.pointsOfDisagreement, ['Concern']);
    assert.equal(result.proposal, 'Use microservices.');
    assert.equal(result.consensusSignal, 'AGREE');
  });

  test('parses ### heading format', () => {
    const raw = '### Analysis\nDetails here.\n\n### Consensus Signal\nDISAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.analysis, 'Details here.');
    assert.equal(result.consensusSignal, 'DISAGREE');
  });

  test('parses **Bold** heading format', () => {
    const raw = '**Analysis**\nBold analysis.\n\n**Consensus Signal**\nPARTIALLY_AGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'PARTIALLY_AGREE');
  });

  test('parses PARTIALLY AGREE (with space) as PARTIALLY_AGREE', () => {
    const raw = '## Consensus Signal\nPARTIALLY AGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'PARTIALLY_AGREE');
  });

  test('defaults consensus signal to DISAGREE when section is absent', () => {
    const raw = '## Analysis\nSome analysis.';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'DISAGREE');
  });

  test('DISAGREE does not match as AGREE', () => {
    const raw = '## Consensus Signal\nDISAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'DISAGREE');
  });

  test('extracts numbered list items as bullets', () => {
    const raw = '## Points of Agreement\n1. Item one\n2. Item two\n## Consensus Signal\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.deepEqual(result.pointsOfAgreement, ['Item one', 'Item two']);
  });

  test('returns empty strings and arrays for missing sections', () => {
    const raw = '## Consensus Signal\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.analysis, '');
    assert.equal(result.proposal, '');
    assert.deepEqual(result.pointsOfAgreement, []);
    assert.deepEqual(result.pointsOfDisagreement, []);
  });

  test('section matching is case-insensitive', () => {
    const raw = '## analysis\nLower case section.\n## consensus signal\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.analysis, 'Lower case section.');
    assert.equal(result.consensusSignal, 'AGREE');
  });

  test('handles optional colon after heading', () => {
    const raw = '## Analysis:\nWith colon.\n## Consensus Signal:\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.analysis, 'With colon.');
    assert.equal(result.consensusSignal, 'AGREE');
  });
});

// ---------------------------------------------------------------------------
// extractCodeArtifact
// ---------------------------------------------------------------------------
describe('extractCodeArtifact', () => {
  test('returns null when no Code Artifact section', () => {
    assert.equal(extractCodeArtifact('## Analysis\nNo code here.'), null);
  });

  test('extracts TypeScript code block', () => {
    const raw = '### Code Artifact\n```typescript\nconst x: number = 42;\n```';
    const result = extractCodeArtifact(raw);
    assert.ok(result);
    assert.equal(result.language, 'typescript');
    assert.equal(result.code, 'const x: number = 42;');
  });

  test('extracts JavaScript code block', () => {
    const raw = '### Code Artifact\n```javascript\nconsole.log("hi");\n```';
    const result = extractCodeArtifact(raw);
    assert.ok(result);
    assert.equal(result.language, 'javascript');
    assert.equal(result.code, 'console.log("hi");');
  });

  test('defaults language to typescript when unspecified', () => {
    const raw = '### Code Artifact\n```\nconst x = 1;\n```';
    const result = extractCodeArtifact(raw);
    assert.ok(result);
    assert.equal(result.language, 'typescript');
    assert.equal(result.code, 'const x = 1;');
  });

  test('returns null for empty code block', () => {
    const raw = '### Code Artifact\n```typescript\n```';
    assert.equal(extractCodeArtifact(raw), null);
  });

  test('uses **Bold** heading format', () => {
    const raw = '**Code Artifact**\n```js\nvar x = 1;\n```';
    const result = extractCodeArtifact(raw);
    assert.ok(result);
    assert.equal(result.language, 'js');
  });
});

// ---------------------------------------------------------------------------
// detectConsensus
// ---------------------------------------------------------------------------
describe('detectConsensus', () => {
  test('returns emerging for empty state', () => {
    assert.equal(detectConsensus(makeState([])), 'emerging');
  });

  test('returns emerging with only 1 respondent', () => {
    assert.equal(detectConsensus(makeState([makeEntry(1, 'claude', 'AGREE')])), 'emerging');
  });

  test('returns full when all participants AGREE', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE'),
      makeEntry(1, 'codex', 'AGREE'),
      makeEntry(1, 'gemini', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state), 'full');
  });

  test('returns disagreement when all DISAGREE', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'DISAGREE'),
      makeEntry(1, 'codex', 'DISAGREE'),
      makeEntry(1, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'disagreement');
  });

  test('returns partial when supermajority agree or partially agree', () => {
    // 2/3 >= 66% → partial
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE'),
      makeEntry(1, 'codex', 'PARTIALLY_AGREE'),
      makeEntry(1, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'partial');
  });

  test('returns emerging with only one positive signal out of three', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE'),
      makeEntry(1, 'codex', 'DISAGREE'),
      makeEntry(1, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'emerging');
  });

  test('evaluates only the latest round', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'DISAGREE'),
      makeEntry(1, 'codex', 'DISAGREE'),
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state), 'full');
  });

  test('returns full when consecutive rounds requirement is met', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE'),
      makeEntry(1, 'codex', 'AGREE'),
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state, 2), 'full');
  });

  test('returns emerging when consecutive rounds requirement is not met', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'DISAGREE'),
      makeEntry(1, 'codex', 'DISAGREE'),
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state, 2), 'emerging');
  });

  test('ignores entries with null parsedSections when counting respondents', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE', false), // no parsedSections — not counted
      makeEntry(1, 'codex', 'AGREE'),
    ]);
    // Only 1 valid respondent → emerging
    assert.equal(detectConsensus(state), 'emerging');
  });

  test('AGREE_WITH_RESERVATION counts as full agreement', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE_WITH_RESERVATION'),
      makeEntry(1, 'codex', 'AGREE_WITH_RESERVATION'),
    ]);
    assert.equal(detectConsensus(state), 'full');
  });

  test('mix of AGREE and AGREE_WITH_RESERVATION counts as full consensus', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE'),
      makeEntry(1, 'codex', 'AGREE_WITH_RESERVATION'),
      makeEntry(1, 'gemini', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state), 'full');
  });

  test('all-AGREE with non-empty deltas → emerging when requireDeltaConvergence=true', () => {
    const agreeWithDeltas: DiscussionEntry = {
      round: 1,
      participant: 'claude',
      timestamp: new Date().toISOString(),
      rawResponse: '',
      parsedSections: {
        substance: '', deltas: ['+ adopted something'], convergence: null,
        analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'AGREE',
      },
    };
    const agreeNoDeltas: DiscussionEntry = {
      round: 1,
      participant: 'codex',
      timestamp: new Date().toISOString(),
      rawResponse: '',
      parsedSections: {
        substance: '', deltas: [], convergence: null,
        analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'AGREE',
      },
    };
    const state = makeState([agreeWithDeltas, agreeNoDeltas]);
    // Without delta convergence: full (all AGREE)
    assert.equal(detectConsensus(state, 1, false), 'full');
    // With delta convergence: emerging (claude still has deltas)
    assert.equal(detectConsensus(state, 1, true), 'emerging');
  });

  test('all-AGREE with all-empty deltas → full when requireDeltaConvergence=true', () => {
    const makeAgreeEntry = (participant: 'claude' | 'codex'): DiscussionEntry => ({
      round: 1,
      participant,
      timestamp: new Date().toISOString(),
      rawResponse: '',
      parsedSections: {
        substance: '', deltas: [], convergence: null,
        analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'AGREE',
      },
    });
    const state = makeState([makeAgreeEntry('claude'), makeAgreeEntry('codex')]);
    assert.equal(detectConsensus(state, 1, true), 'full');
  });

  test('AGREE_WITH_RESERVATION with consecutive rounds requirement', () => {
    const state = makeState([
      makeEntry(1, 'claude', 'AGREE_WITH_RESERVATION'),
      makeEntry(1, 'codex', 'AGREE_WITH_RESERVATION'),
      makeEntry(2, 'claude', 'AGREE_WITH_RESERVATION'),
      makeEntry(2, 'codex', 'AGREE_WITH_RESERVATION'),
    ]);
    assert.equal(detectConsensus(state, 2), 'full');
  });
});

// ---------------------------------------------------------------------------
// AGREE_WITH_RESERVATION signal parsing
// ---------------------------------------------------------------------------
describe('AGREE_WITH_RESERVATION parsing', () => {
  test('parses valid AGREE_WITH_RESERVATION with ≥20 words', () => {
    const reservation = 'the deployment risk remains unmitigated especially if the load balancer fails during peak traffic and we have no fallback configured';
    const raw = `### Substance\nMy position.\n\n### Deltas\nNone\n\n### Consensus Signal\nAGREE_WITH_RESERVATION: ${reservation}`;
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'AGREE_WITH_RESERVATION');
    assert.ok(result.reservation);
    assert.ok(result.reservation!.length > 0);
  });

  test('short reservation (<20 words) demotes to PARTIALLY_AGREE', () => {
    const raw = '### Substance\nMy position.\n\n### Deltas\nNone\n\n### Consensus Signal\nAGREE_WITH_RESERVATION: only five words here';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'PARTIALLY_AGREE');
    assert.equal(result.reservation, undefined);
  });

  test('exactly 20-word reservation is valid', () => {
    const words = Array(20).fill('word').join(' ');
    const raw = `### Consensus Signal\nAGREE_WITH_RESERVATION: ${words}`;
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'AGREE_WITH_RESERVATION');
  });

  test('19-word reservation demotes to PARTIALLY_AGREE', () => {
    const words = Array(19).fill('word').join(' ');
    const raw = `### Consensus Signal\nAGREE_WITH_RESERVATION: ${words}`;
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'PARTIALLY_AGREE');
  });

  test('AGREE_WITH_RESERVATION is case-insensitive', () => {
    const reservation = Array(20).fill('concern').join(' ');
    const raw = `### Consensus Signal\nagree_with_reservation: ${reservation}`;
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'AGREE_WITH_RESERVATION');
  });

  test('bare AGREE still parsed as AGREE (backward compat)', () => {
    const raw = '### Consensus Signal\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.consensusSignal, 'AGREE');
    assert.equal(result.reservation, undefined);
  });

  test('reservation is not set when signal is AGREE', () => {
    const raw = '### Substance\nMy position.\n\n### Deltas\nNone\n\n### Consensus Signal\nAGREE';
    const result = parseResponseSections(raw);
    assert.ok(result);
    assert.equal(result.reservation, undefined);
  });
});

// ---------------------------------------------------------------------------
// isDeltasConverged
// ---------------------------------------------------------------------------
describe('isDeltasConverged', () => {
  function makeEntryWithDeltas(
    round: number,
    participant: 'claude' | 'codex' | 'gemini',
    deltas: string[],
  ): DiscussionEntry {
    return {
      round,
      participant,
      timestamp: new Date().toISOString(),
      rawResponse: '',
      parsedSections: {
        substance: '', deltas, convergence: null,
        analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'AGREE',
      },
    };
  }

  test('returns true when all participants have empty deltas', () => {
    const state = makeState([
      makeEntryWithDeltas(1, 'claude', []),
      makeEntryWithDeltas(1, 'codex', []),
    ]);
    assert.equal(isDeltasConverged(state, 1), true);
  });

  test('returns false when any participant has non-empty deltas', () => {
    const state = makeState([
      makeEntryWithDeltas(1, 'claude', ['+ adopted something']),
      makeEntryWithDeltas(1, 'codex', []),
    ]);
    assert.equal(isDeltasConverged(state, 1), false);
  });

  test('returns true for empty round (no entries)', () => {
    assert.equal(isDeltasConverged(makeState([]), 1), true);
  });

  test('null parsedSections entries are non-blocking', () => {
    const state = makeState([
      {
        round: 1, participant: 'claude', timestamp: '', rawResponse: '', parsedSections: null,
      },
      makeEntryWithDeltas(1, 'codex', []),
    ]);
    assert.equal(isDeltasConverged(state, 1), true);
  });

  test('only checks the specified round', () => {
    const state = makeState([
      makeEntryWithDeltas(1, 'claude', ['+ old delta from round 1']),
      makeEntryWithDeltas(2, 'claude', []),
      makeEntryWithDeltas(2, 'codex', []),
    ]);
    assert.equal(isDeltasConverged(state, 1), false);
    assert.equal(isDeltasConverged(state, 2), true);
  });
});

// ---------------------------------------------------------------------------
// extractReservations
// ---------------------------------------------------------------------------
describe('extractReservations', () => {
  test('extracts reservation texts from a round', () => {
    const state = makeState([
      {
        round: 1, participant: 'claude', timestamp: '', rawResponse: '',
        parsedSections: {
          substance: '', deltas: [], convergence: null,
          analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
          consensusSignal: 'AGREE_WITH_RESERVATION',
          reservation: 'my specific concern about the failure mode',
        },
      },
      {
        round: 1, participant: 'codex', timestamp: '', rawResponse: '',
        parsedSections: {
          substance: '', deltas: [], convergence: null,
          analysis: '', proposal: '', pointsOfAgreement: [], pointsOfDisagreement: [],
          consensusSignal: 'AGREE',
        },
      },
    ]);
    const reservations = extractReservations(state, 1);
    assert.equal(reservations.length, 1);
    assert.ok(reservations[0].includes('[claude]'));
    assert.ok(reservations[0].includes('failure mode'));
  });

  test('returns empty array when no reservations in round', () => {
    const state = makeState([makeEntry(1, 'claude', 'AGREE'), makeEntry(1, 'codex', 'DISAGREE')]);
    assert.deepEqual(extractReservations(state, 1), []);
  });
});
