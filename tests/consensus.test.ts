import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponseSections, extractCodeArtifact, detectConsensus } from '../src/consensus.js';
import type { DiscussionState, DiscussionEntry, ConsensusSignal } from '../src/types.js';

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
});
