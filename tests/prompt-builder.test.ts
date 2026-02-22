import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlindDraftPrompt, buildRoundPrompt, buildInitialPrompt } from '../src/prompt-builder.js';
import type { DiscussionState } from '../src/types.js';

function makeState(): DiscussionState {
  return {
    topic: 'Should we adopt microservices?',
    participants: ['claude', 'codex'],
    startedAt: new Date().toISOString(),
    entries: [],
    consensusStatus: 'emerging',
    finalPlan: null,
  };
}

// ---------------------------------------------------------------------------
// buildBlindDraftPrompt
// ---------------------------------------------------------------------------
describe('buildBlindDraftPrompt', () => {
  test('includes topic and round info', () => {
    const prompt = buildBlindDraftPrompt('My topic', 'claude', 2, 5);
    assert.ok(prompt.includes('Round 2 of 5'));
    assert.ok(prompt.includes('My topic'));
  });

  test('instructs to write only Substance section', () => {
    const prompt = buildBlindDraftPrompt('My topic', 'claude', 2, 5);
    assert.ok(prompt.includes('### Substance'));
    assert.ok(prompt.includes('No Deltas'));
    assert.ok(prompt.includes('No Consensus Signal'));
  });

  test('says "without seeing peers" to enforce blind drafting', () => {
    const prompt = buildBlindDraftPrompt('My topic', 'claude', 2, 5);
    assert.ok(prompt.toLowerCase().includes('without seeing peers'));
  });

  test('includes user guidance when provided', () => {
    const prompt = buildBlindDraftPrompt('My topic', 'claude', 2, 5, 'Focus on security');
    assert.ok(prompt.includes('Focus on security'));
  });

  test('omits guidance section when not provided', () => {
    const prompt = buildBlindDraftPrompt('My topic', 'claude', 2, 5);
    assert.ok(!prompt.includes('Project guidance'));
  });

  test('truncates very long topics to 300 chars', () => {
    const longTopic = 'x'.repeat(400);
    const prompt = buildBlindDraftPrompt(longTopic, 'claude', 2, 5);
    assert.ok(prompt.includes('x'.repeat(300)));
    assert.ok(!prompt.includes('x'.repeat(301)));
  });
});

// ---------------------------------------------------------------------------
// buildRoundPrompt with blindDraft parameter
// ---------------------------------------------------------------------------
describe('buildRoundPrompt with blindDraft', () => {
  test('prepends blind draft when provided', () => {
    const state = makeState();
    // Add a round-1 entry so round 2 has something to reference
    state.entries.push({
      round: 1,
      participant: 'codex',
      timestamp: new Date().toISOString(),
      rawResponse: 'Round 1 response from codex',
      parsedSections: {
        substance: 'My plan', deltas: [], convergence: null,
        analysis: 'My plan', proposal: 'My plan',
        pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'DISAGREE',
      },
    });

    const prompt = buildRoundPrompt(state, 'claude', 2, 5, undefined, false, 'My blind draft position here');
    assert.ok(prompt.includes('Your blind draft'));
    assert.ok(prompt.includes('My blind draft position here'));
    assert.ok(prompt.includes('do not change your core position'));
  });

  test('does not include blind draft header when blindDraft is undefined', () => {
    const state = makeState();
    const prompt = buildRoundPrompt(state, 'claude', 2, 5);
    assert.ok(!prompt.includes('Your blind draft'));
  });

  test('blank blindDraft string does not add header', () => {
    const state = makeState();
    const prompt = buildRoundPrompt(state, 'claude', 2, 5, undefined, false, '');
    assert.ok(!prompt.includes('Your blind draft'));
  });
});

// ---------------------------------------------------------------------------
// Updated Consensus Signal instructions in templates
// ---------------------------------------------------------------------------
describe('Consensus Signal instructions in prompts', () => {
  test('initial prompt mentions AGREE_WITH_RESERVATION', () => {
    const prompt = buildInitialPrompt('My topic', 'claude', 1, 5);
    assert.ok(prompt.includes('AGREE_WITH_RESERVATION'));
  });

  test('round prompt mentions AGREE_WITH_RESERVATION', () => {
    const state = makeState();
    state.entries.push({
      round: 1,
      participant: 'codex',
      timestamp: new Date().toISOString(),
      rawResponse: 'response',
      parsedSections: {
        substance: 'plan', deltas: [], convergence: null,
        analysis: 'plan', proposal: 'plan',
        pointsOfAgreement: [], pointsOfDisagreement: [],
        consensusSignal: 'PARTIALLY_AGREE',
      },
    });
    const prompt = buildRoundPrompt(state, 'claude', 2, 5);
    assert.ok(prompt.includes('AGREE_WITH_RESERVATION'));
  });

  test('round prompt explains ≥20 words requirement', () => {
    const state = makeState();
    const prompt = buildRoundPrompt(state, 'claude', 2, 5);
    assert.ok(prompt.includes('≥20'));
  });
});
