import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, selectSummarizer, runDiscussionWithParticipants } from '../src/orchestrator.js';
import { detectConsensus } from '../src/consensus.js';
import { evaluateQualityGate } from '../src/quality-gate.js';
import type { DiscussionState, DiscussionEntry, ConsensusSignal, ParticipantId, MultiAiConfig } from '../src/types.js';
import { BaseParticipant } from '../src/participants/base.js';
import type { CommandSpec } from '../src/participants/base.js';
import type { ProcessResult, ParticipantOutput } from '../src/types.js';

// Minimal participant stub for selectSummarizer tests
class StubParticipant extends BaseParticipant {
  buildFirstCommand(_prompt: string): CommandSpec {
    return { command: this.id, args: [] };
  }
  buildContinueCommand(_prompt: string): CommandSpec {
    return { command: this.id, args: [] };
  }
  parseOutput(_result: ProcessResult): ParticipantOutput {
    return { response: '' };
  }
}

function makeParticipant(id: ParticipantId, lead = false): StubParticipant {
  return new StubParticipant({ id, enabled: true, cliPath: id, timeoutMs: 5000, lead });
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  test('formats sub-second durations in ms', () => {
    assert.equal(formatDuration(0), '0ms');
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(999), '999ms');
  });

  test('formats seconds for durations under 1 minute', () => {
    assert.equal(formatDuration(1000), '1.0s');
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(59999), '60.0s');
  });

  test('formats minutes and seconds for durations >= 1 minute', () => {
    assert.equal(formatDuration(60000), '1m 0s');
    assert.equal(formatDuration(90000), '1m 30s');
    assert.equal(formatDuration(125000), '2m 5s');
    assert.equal(formatDuration(3600000), '60m 0s');
  });
});

// ---------------------------------------------------------------------------
// Tie-breaker activation condition (via detectConsensus)
//
// The orchestrator activates the tie-breaker only on 'disagreement' status —
// NOT on 'emerging'. These tests guard against regression to the old
// behaviour where 'emerging' also triggered the tie-breaker too early.
// ---------------------------------------------------------------------------
function makeEntry(
  round: number,
  participant: 'claude' | 'codex' | 'gemini',
  signal: ConsensusSignal,
): DiscussionEntry {
  return {
    round,
    participant,
    timestamp: new Date().toISOString(),
    rawResponse: '',
    parsedSections: { analysis: '', pointsOfAgreement: [], pointsOfDisagreement: [], proposal: '', consensusSignal: signal },
  };
}

function makeState(entries: DiscussionEntry[]): DiscussionState {
  return { topic: 'test', participants: ['claude', 'codex', 'gemini'], startedAt: '', entries, consensusStatus: 'emerging', finalPlan: null };
}

describe('tie-breaker activation guard (detectConsensus status)', () => {
  test('returns "disagreement" when all participants disagree — tie-breaker SHOULD fire', () => {
    const state = makeState([
      makeEntry(2, 'claude', 'DISAGREE'),
      makeEntry(2, 'codex', 'DISAGREE'),
      makeEntry(2, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'disagreement');
  });

  test('returns "emerging" when one participant agrees — tie-breaker should NOT fire', () => {
    const state = makeState([
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'DISAGREE'),
      makeEntry(2, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'emerging');
  });

  test('returns "partial" when supermajority agrees — tie-breaker should NOT fire', () => {
    const state = makeState([
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'PARTIALLY_AGREE'),
      makeEntry(2, 'gemini', 'DISAGREE'),
    ]);
    assert.equal(detectConsensus(state), 'partial');
  });

  test('returns "full" when all agree — tie-breaker should NOT fire', () => {
    const state = makeState([
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'AGREE'),
      makeEntry(2, 'gemini', 'AGREE'),
    ]);
    assert.equal(detectConsensus(state), 'full');
  });

  test('"emerging" is distinct from "disagreement" — the two must not be conflated', () => {
    // This is the key regression test. Pre-fix, the orchestrator checked
    // (status === 'disagreement' || status === 'emerging') which caused the
    // tie-breaker to fire even when discussion was progressing normally.
    const emerging = makeState([
      makeEntry(2, 'claude', 'AGREE'),
      makeEntry(2, 'codex', 'DISAGREE'),
      makeEntry(2, 'gemini', 'DISAGREE'),
    ]);
    const disagreement = makeState([
      makeEntry(2, 'claude', 'DISAGREE'),
      makeEntry(2, 'codex', 'DISAGREE'),
      makeEntry(2, 'gemini', 'DISAGREE'),
    ]);
    assert.notEqual(detectConsensus(emerging), detectConsensus(disagreement));
    assert.equal(detectConsensus(emerging), 'emerging');
    assert.equal(detectConsensus(disagreement), 'disagreement');
  });
});

// ---------------------------------------------------------------------------
// selectSummarizer (Item 5)
// ---------------------------------------------------------------------------
describe('selectSummarizer', () => {
  test('prefers the lead participant when present and not failed', () => {
    const claude = makeParticipant('claude', true); // lead
    const codex = makeParticipant('codex');
    const gemini = makeParticipant('gemini');
    const state = makeState([makeEntry(1, 'claude', 'AGREE')]);
    const result = selectSummarizer([claude, codex, gemini], new Set(), state);
    assert.equal(result.id, 'claude');
  });

  test('skips failed lead, falls back to highest AGREE count', () => {
    const claude = makeParticipant('claude', true); // lead but failed
    const codex = makeParticipant('codex');
    const gemini = makeParticipant('gemini');
    const state = makeState([
      makeEntry(1, 'codex', 'AGREE'),
      makeEntry(2, 'codex', 'AGREE'),
      makeEntry(1, 'gemini', 'AGREE'),
    ]);
    const failed = new Set<ParticipantId>(['claude']);
    const result = selectSummarizer([claude, codex, gemini], failed, state);
    assert.equal(result.id, 'codex'); // codex has 2 AGREEs vs gemini's 1
  });

  test('returns first available when no lead and no AGREE signals', () => {
    const claude = makeParticipant('claude');
    const codex = makeParticipant('codex');
    const state = makeState([makeEntry(1, 'claude', 'DISAGREE')]);
    const result = selectSummarizer([claude, codex], new Set(), state);
    // Either is valid, just must not throw and must return an available participant
    assert.ok(result.id === 'claude' || result.id === 'codex');
  });

  test('falls back to participants[0] when all are in permanentlyFailed', () => {
    const claude = makeParticipant('claude');
    const codex = makeParticipant('codex');
    const state = makeState([]);
    const failed = new Set<ParticipantId>(['claude', 'codex']);
    // All failed — falls back to participants[0]
    const result = selectSummarizer([claude, codex], failed, state);
    assert.equal(result.id, 'claude');
  });
});

// ---------------------------------------------------------------------------
// Graduated failure counter logic (Item 8) — tested via the counter concept
// ---------------------------------------------------------------------------
describe('graduated failure policy (counter logic)', () => {
  test('failure counter increments and triggers permanent removal at 2', () => {
    // Simulate the counter logic from the orchestrator
    const roundFailureCount = new Map<ParticipantId, number>();
    const permanentlyFailed = new Set<ParticipantId>();

    function recordFailure(id: ParticipantId) {
      const newCount = (roundFailureCount.get(id) ?? 0) + 1;
      roundFailureCount.set(id, newCount);
      if (newCount >= 2) permanentlyFailed.add(id);
    }

    recordFailure('codex');
    assert.equal(permanentlyFailed.has('codex'), false, 'Should not be removed after 1 failure');
    assert.equal(roundFailureCount.get('codex'), 1);

    recordFailure('codex');
    assert.equal(permanentlyFailed.has('codex'), true, 'Should be removed after 2 consecutive failures');
  });

  test('success resets the failure counter', () => {
    const roundFailureCount = new Map<ParticipantId, number>();
    const permanentlyFailed = new Set<ParticipantId>();

    function recordFailure(id: ParticipantId) {
      const newCount = (roundFailureCount.get(id) ?? 0) + 1;
      roundFailureCount.set(id, newCount);
      if (newCount >= 2) permanentlyFailed.add(id);
    }
    function recordSuccess(id: ParticipantId) {
      roundFailureCount.set(id, 0);
    }

    recordFailure('gemini');
    recordSuccess('gemini');
    recordFailure('gemini'); // only 1 failure since last success
    assert.equal(permanentlyFailed.has('gemini'), false, 'Should not be removed — counter was reset by success');
    assert.equal(roundFailureCount.get('gemini'), 1);
  });
});

// ---------------------------------------------------------------------------
// Stall detection (Item 11) — proposal comparison logic
// ---------------------------------------------------------------------------
describe('stall detection logic', () => {
  test('increments staleRoundsCount when majority of proposals are unchanged', () => {
    let staleRoundsCount = 0;
    const lastProposals = new Map<ParticipantId, string>();

    function checkStagnation(currentProposals: Map<ParticipantId, string>) {
      const stagnantCount = Array.from(currentProposals.entries())
        .filter(([id, p]) => lastProposals.get(id) === p).length;
      if (currentProposals.size > 0 && stagnantCount > currentProposals.size / 2) {
        staleRoundsCount++;
      } else {
        staleRoundsCount = 0;
      }
      for (const [id, p] of currentProposals) lastProposals.set(id, p);
    }

    const round1 = new Map<ParticipantId, string>([['claude', 'use REST'], ['codex', 'use GraphQL']]);
    checkStagnation(round1);
    assert.equal(staleRoundsCount, 0, 'No stagnation on first comparison (nothing in lastProposals)');

    // Same proposals as round1 → both stagnant (2 out of 2 > 1)
    const round2 = new Map<ParticipantId, string>([['claude', 'use REST'], ['codex', 'use GraphQL']]);
    checkStagnation(round2);
    assert.equal(staleRoundsCount, 1, 'Stagnation detected when all proposals unchanged');

    // One proposal changed → only 1 out of 2 stagnant (not > 1), resets counter
    const round3 = new Map<ParticipantId, string>([['claude', 'use REST + caching'], ['codex', 'use GraphQL']]);
    checkStagnation(round3);
    assert.equal(staleRoundsCount, 0, 'Counter resets when proposals change');
  });
});

// ---------------------------------------------------------------------------
// Quality gate (evaluateQualityGate)
// ---------------------------------------------------------------------------
function makeFullEntry(
  round: number,
  participant: 'claude' | 'codex' | 'gemini',
  signal: ConsensusSignal,
  proposal = 'Use microservices',
): DiscussionEntry {
  return {
    round,
    participant,
    timestamp: new Date().toISOString(),
    rawResponse: '',
    parsedSections: {
      analysis: '',
      pointsOfAgreement: [],
      pointsOfDisagreement: [],
      proposal,
      consensusSignal: signal,
    },
  };
}

function makeStateWithEntries(entries: DiscussionEntry[]): DiscussionState {
  return { topic: 'test', participants: ['claude', 'codex', 'gemini'], startedAt: '', entries, consensusStatus: 'emerging', finalPlan: null };
}

describe('evaluateQualityGate', () => {
  test('pass — all AGREE with non-empty proposals and consensus reached', () => {
    const state = makeStateWithEntries([
      makeFullEntry(2, 'claude', 'AGREE', 'Use REST'),
      makeFullEntry(2, 'codex', 'AGREE', 'Use REST'),
      makeFullEntry(2, 'gemini', 'AGREE', 'Use REST'),
    ]);
    state.consensusStatus = 'full';
    const gate = evaluateQualityGate(state, true, false);
    assert.equal(gate, 'pass');
  });

  test('fail — DISAGREE majority in final round', () => {
    const state = makeStateWithEntries([
      makeFullEntry(2, 'claude', 'DISAGREE', 'REST'),
      makeFullEntry(2, 'codex', 'DISAGREE', 'GraphQL'),
      makeFullEntry(2, 'gemini', 'AGREE', 'REST'),
    ]);
    const gate = evaluateQualityGate(state, false, false);
    assert.equal(gate, 'fail');
  });

  test('fail — parse errors dominate final round', () => {
    const state: DiscussionState = {
      topic: 'test', participants: ['claude', 'codex', 'gemini'], startedAt: '', consensusStatus: 'emerging', finalPlan: null,
      entries: [
        { round: 1, participant: 'claude', timestamp: '', rawResponse: '', parsedSections: null },
        { round: 1, participant: 'codex', timestamp: '', rawResponse: '', parsedSections: null },
        { round: 1, participant: 'gemini', timestamp: '', rawResponse: '', parsedSections: { analysis: '', pointsOfAgreement: [], pointsOfDisagreement: [], proposal: 'ok', consensusSignal: 'AGREE' } },
      ],
    };
    const gate = evaluateQualityGate(state, false, false);
    assert.equal(gate, 'fail');
  });

  test('warn — max rounds reached without consensus', () => {
    const state = makeStateWithEntries([
      makeFullEntry(3, 'claude', 'PARTIALLY_AGREE', 'Hybrid'),
      makeFullEntry(3, 'codex', 'AGREE', 'REST'),
    ]);
    const gate = evaluateQualityGate(state, false, true);
    assert.equal(gate, 'warn');
  });

  test('warn — PARTIALLY_AGREE majority', () => {
    const state = makeStateWithEntries([
      makeFullEntry(2, 'claude', 'PARTIALLY_AGREE', 'Hybrid'),
      makeFullEntry(2, 'codex', 'PARTIALLY_AGREE', 'Hybrid'),
      makeFullEntry(2, 'gemini', 'AGREE', 'REST'),
    ]);
    const gate = evaluateQualityGate(state, false, false);
    assert.equal(gate, 'warn');
  });

  test('fail — no entries at all', () => {
    const state = makeStateWithEntries([]);
    const gate = evaluateQualityGate(state, false, false);
    assert.equal(gate, 'fail');
  });
});

// ---------------------------------------------------------------------------
// Mocked E2E integration test
//
// Uses MockParticipant adapters that emit deterministic formatted responses
// via `node -e`. Tests the full orchestration control flow:
//  - Round 1: codex returns null (simulated failure)
//  - Round 2: codex recovers; all PARTIALLY_AGREE
//  - Round 3: all AGREE → consensus
//
// No real CLIs are invoked. skipPreflight: true bypasses preflight checks.
// ---------------------------------------------------------------------------
const AGREE_RESPONSE = `### Substance
Use microservices with REST APIs. Stateless services, API gateway for routing, shared auth layer.

### Deltas
None

### Consensus Signal
AGREE`;

const PARTIAL_RESPONSE = `### Substance
Use REST with optional GraphQL layer. REST for public endpoints, GraphQL for internal aggregation only.

### Deltas
None

### Consensus Signal
PARTIALLY_AGREE`;

class MockParticipant extends BaseParticipant {
  private responseQueue: (string | null)[];
  private queueIdx = 0;

  constructor(id: ParticipantId, responses: (string | null)[]) {
    // maxRetries: 0 ensures each round gets exactly one attempt from the queue
    super({ id, enabled: true, cliPath: 'node', timeoutMs: 10000, maxRetries: 0 });
    this.responseQueue = responses;
  }

  buildFirstCommand(_prompt: string): CommandSpec {
    const response = this.responseQueue[this.queueIdx++] ?? null;
    if (response === null) {
      return { command: 'node', args: ['-e', 'process.exit(1)'] };
    }
    const encoded = Buffer.from(response).toString('base64');
    return {
      command: 'node',
      args: ['-e', `process.stdout.write(Buffer.from('${encoded}','base64').toString())`],
    };
  }

  buildContinueCommand(prompt: string): CommandSpec {
    return this.buildFirstCommand(prompt);
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    return { response: result.stdout };
  }

  modelDisplay(): string { return 'mock'; }
}

// Minimal config for mock E2E tests
function mockConfig(overrides: Partial<MultiAiConfig> = {}): MultiAiConfig {
  return {
    maxRounds: 4,
    participants: [],
    outputDir: './.test-tmp',
    outputFile: `mock-discussion-${Date.now()}.md`,
    consensusThreshold: 1,
    verbose: false,
    watch: false,
    validateArtifacts: false,
    stream: false,
    dryRun: false,
    debug: false,
    skipPreflight: true,
    ...overrides,
  };
}

describe('Mocked E2E: orchestration control flow', () => {
  test('3-round flow: codex fails round 1, recovers; all AGREE by round 3', async () => {
    const participants = [
      new MockParticipant('claude', [AGREE_RESPONSE, AGREE_RESPONSE, AGREE_RESPONSE]),
      new MockParticipant('codex', [null, PARTIAL_RESPONSE, AGREE_RESPONSE]),  // fails round 1
      new MockParticipant('gemini', [PARTIAL_RESPONSE, PARTIAL_RESPONSE, AGREE_RESPONSE]),
    ];

    const config = mockConfig();
    const result = await runDiscussionWithParticipants('API design topic', config, participants);

    assert.ok(result.consensusReached, 'Consensus should be reached');
    assert.equal(result.qualityGate, 'pass', 'Quality gate should pass on consensus');
    assert.equal(result.status, 'consensus');
    assert.ok(result.roundCount >= 3, `Expected at least 3 rounds, got ${result.roundCount}`);
    assert.ok(result.runId.length > 0, 'runId should be set');
    assert.ok(result.durationMs >= 0, 'durationMs should be non-negative');
  });

  test('failure counter resets on success — no permanent removal', async () => {
    // codex fails round 1 (failure count → 1) then succeeds round 2 (counter resets to 0).
    // claude and gemini give PARTIAL in round 1 so early consensus is not triggered before
    // codex recovers. All three AGREE in round 2 → consensus reached.
    const participants = [
      new MockParticipant('claude', [PARTIAL_RESPONSE, AGREE_RESPONSE, AGREE_RESPONSE]),
      new MockParticipant('codex', [null, AGREE_RESPONSE, AGREE_RESPONSE]),  // 1 fail then succeeds
      new MockParticipant('gemini', [PARTIAL_RESPONSE, AGREE_RESPONSE, AGREE_RESPONSE]),
    ];

    const config = mockConfig();
    const result = await runDiscussionWithParticipants('Test topic', config, participants);

    const codexStats = result.participants.find((p) => p.id === 'codex');
    assert.ok(codexStats, 'codex should be in participants stats');
    assert.equal(codexStats!.failures, 1, 'codex should have exactly 1 failure (round 1)');
    // Codex recovered and participated in at least round 2
    assert.ok(codexStats!.rounds >= 1, 'codex should have participated in at least 1 round after recovery');
  });

  test('quality gate = warn when max rounds reached without consensus', async () => {
    // All participants PARTIALLY_AGREE every round — never reach full consensus
    const partial = PARTIAL_RESPONSE;
    const participants = [
      new MockParticipant('claude', [partial, partial, partial]),
      new MockParticipant('codex', [partial, partial, partial]),
      new MockParticipant('gemini', [partial, partial, partial]),
    ];

    const config = mockConfig({ maxRounds: 3 });
    const result = await runDiscussionWithParticipants('Partial topic', config, participants);

    assert.equal(result.consensusReached, false, 'Should not reach full consensus');
    assert.ok(
      result.qualityGate === 'warn' || result.qualityGate === 'fail',
      `Quality gate should be warn or fail when no consensus, got: ${result.qualityGate}`,
    );
  });
});
