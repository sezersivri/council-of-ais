import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DiscussionState } from '../src/types.js';
import { replay } from '../src/replay.js';

const TMP_DIR = tmpdir();

function makeState(overrides: Partial<DiscussionState> = {}): DiscussionState {
  return {
    topic: 'Should we use REST or GraphQL?',
    participants: ['claude', 'codex', 'gemini'],
    startedAt: '2026-01-01T00:00:00.000Z',
    entries: [],
    consensusStatus: 'emerging',
    finalPlan: null,
    ...overrides,
  };
}

describe('replay()', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(TMP_DIR, `replay-test-${Date.now()}.json`);
  });

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  test('reads a state file and prints without throwing', () => {
    writeFileSync(tmpFile, JSON.stringify(makeState()), 'utf-8');
    assert.doesNotThrow(() => replay(tmpFile));
  });

  test('handles empty entries gracefully', () => {
    writeFileSync(tmpFile, JSON.stringify(makeState({ entries: [] })), 'utf-8');
    assert.doesNotThrow(() => replay(tmpFile));
  });

  test('handles state with entries and finalPlan', () => {
    const state = makeState({
      entries: [
        {
          round: 1,
          participant: 'claude',
          timestamp: '2026-01-01T00:01:00.000Z',
          rawResponse: '### Analysis\nHere is my view.\n### Points of Agreement\n- Point A\n### Points of Disagreement\n- Point B\n### Proposal\nUse REST\n### Consensus Signal\nDISAGREE',
          parsedSections: {
            analysis: 'Here is my view.',
            pointsOfAgreement: ['Point A'],
            pointsOfDisagreement: ['Point B'],
            proposal: 'Use REST',
            consensusSignal: 'DISAGREE',
          },
        },
      ],
      finalPlan: '# Final Plan\nUse REST with caching.',
    });
    writeFileSync(tmpFile, JSON.stringify(state), 'utf-8');
    assert.doesNotThrow(() => replay(tmpFile));
  });

  test('handles entries with null parsedSections (falls back to rawResponse)', () => {
    const state = makeState({
      entries: [
        {
          round: 1,
          participant: 'codex',
          timestamp: '2026-01-01T00:01:00.000Z',
          rawResponse: 'Some unstructured response text.',
          parsedSections: null,
        },
      ],
    });
    writeFileSync(tmpFile, JSON.stringify(state), 'utf-8');
    assert.doesNotThrow(() => replay(tmpFile));
  });

  test('throws a readable error for missing file', () => {
    assert.throws(
      () => replay('/nonexistent/path/state.json'),
      (err: Error) => err.message.includes('Failed to read state file'),
    );
  });

  test('throws a readable error for invalid JSON', () => {
    writeFileSync(tmpFile, 'not valid json', 'utf-8');
    assert.throws(
      () => replay(tmpFile),
      (err: Error) => err.message.includes('Failed to read state file'),
    );
  });
});
