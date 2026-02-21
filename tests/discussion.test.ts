import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import {
  initializeDiscussion,
  appendEntry,
  appendFinalPlan,
  getLatestEntriesPerParticipant,
} from '../src/discussion.js';
import type { DiscussionEntry, DiscussionState } from '../src/types.js';

function makeEntry(round: number, participant: 'claude' | 'codex' | 'gemini'): DiscussionEntry {
  return {
    round,
    participant,
    timestamp: new Date().toISOString(),
    rawResponse: `Response from ${participant} round ${round}`,
    parsedSections: null,
  };
}

// ---------------------------------------------------------------------------
// getLatestEntriesPerParticipant
// ---------------------------------------------------------------------------
describe('getLatestEntriesPerParticipant', () => {
  function makeState(entries: DiscussionEntry[]): DiscussionState {
    return { topic: 'test', participants: ['claude', 'codex'], startedAt: '', entries, consensusStatus: 'emerging', finalPlan: null };
  }

  test('returns empty map when state has no entries', () => {
    const result = getLatestEntriesPerParticipant(makeState([]), 1);
    assert.equal(result.size, 0);
  });

  test('returns entries matching the requested round', () => {
    const e1 = makeEntry(1, 'claude');
    const e2 = makeEntry(1, 'codex');
    const state = makeState([e1, e2, makeEntry(2, 'claude')]);
    const result = getLatestEntriesPerParticipant(state, 1);
    assert.equal(result.size, 2);
    assert.equal(result.get('claude'), e1);
    assert.equal(result.get('codex'), e2);
  });

  test('does not include entries from other rounds', () => {
    const state = makeState([makeEntry(1, 'claude'), makeEntry(2, 'claude')]);
    const result = getLatestEntriesPerParticipant(state, 2);
    assert.equal(result.size, 1);
    assert.equal(result.get('claude')?.round, 2);
  });

  test('last entry wins when participant appears multiple times in a round', () => {
    const first = makeEntry(1, 'claude');
    const second = makeEntry(1, 'claude');
    const result = getLatestEntriesPerParticipant(makeState([first, second]), 1);
    assert.equal(result.get('claude'), second);
  });
});

// ---------------------------------------------------------------------------
// initializeDiscussion
// ---------------------------------------------------------------------------
describe('initializeDiscussion', () => {
  test('creates state with correct shape', () => {
    const filePath = join(tmpdir(), `test-init-${Date.now()}.md`);
    try {
      const state = initializeDiscussion(filePath, 'Test Topic', ['claude', 'codex']);
      assert.equal(state.topic, 'Test Topic');
      assert.deepEqual(state.participants, ['claude', 'codex']);
      assert.deepEqual(state.entries, []);
      assert.equal(state.consensusStatus, 'emerging');
      assert.equal(state.finalPlan, null);
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });

  test('writes markdown header to file', () => {
    const filePath = join(tmpdir(), `test-init-${Date.now()}.md`);
    try {
      initializeDiscussion(filePath, 'My Topic', ['claude', 'gemini']);
      assert.ok(existsSync(filePath));
      const content = readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('My Topic'));
      assert.ok(content.includes('CLAUDE'));
      assert.ok(content.includes('GEMINI'));
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });

  test('creates parent directory if it does not exist', () => {
    const dir = join(tmpdir(), `test-dir-${Date.now()}`);
    const filePath = join(dir, 'discussion.md');
    try {
      initializeDiscussion(filePath, 'Topic', ['claude']);
      assert.ok(existsSync(filePath));
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// appendEntry
// ---------------------------------------------------------------------------
describe('appendEntry', () => {
  test('pushes entry into state.entries and writes to file', () => {
    const filePath = join(tmpdir(), `test-append-${Date.now()}.md`);
    try {
      const state = initializeDiscussion(filePath, 'Test', ['claude']);
      const entry = makeEntry(1, 'claude');
      appendEntry(filePath, state, entry);
      assert.equal(state.entries.length, 1);
      assert.equal(state.entries[0], entry);
      const content = readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('Round 1'));
      assert.ok(content.includes('CLAUDE'));
      assert.ok(content.includes(entry.rawResponse));
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });

  test('accumulates multiple entries in order', () => {
    const filePath = join(tmpdir(), `test-append-${Date.now()}.md`);
    try {
      const state = initializeDiscussion(filePath, 'Test', ['claude', 'codex']);
      appendEntry(filePath, state, makeEntry(1, 'claude'));
      appendEntry(filePath, state, makeEntry(1, 'codex'));
      assert.equal(state.entries.length, 2);
      assert.equal(state.entries[0].participant, 'claude');
      assert.equal(state.entries[1].participant, 'codex');
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// appendFinalPlan
// ---------------------------------------------------------------------------
describe('appendFinalPlan', () => {
  test('sets state.finalPlan and writes consensus section to file', () => {
    const filePath = join(tmpdir(), `test-final-${Date.now()}.md`);
    try {
      const state = initializeDiscussion(filePath, 'Test', ['claude']);
      appendFinalPlan(filePath, state, 'The agreed plan.', true);
      assert.equal(state.finalPlan, 'The agreed plan.');
      const content = readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('Consensus Plan'));
      assert.ok(content.includes('The agreed plan.'));
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });

  test('uses summary heading when no consensus reached', () => {
    const filePath = join(tmpdir(), `test-final-${Date.now()}.md`);
    try {
      const state = initializeDiscussion(filePath, 'Test', ['claude']);
      appendFinalPlan(filePath, state, 'Partial plan.', false);
      const content = readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('No Full Consensus'));
    } finally {
      try { rmSync(filePath); } catch { /* ignore */ }
    }
  });
});
