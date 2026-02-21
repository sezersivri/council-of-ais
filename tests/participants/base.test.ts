import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseParticipant } from '../../src/participants/base.js';
import type { CommandSpec } from '../../src/participants/base.js';
import type { ParticipantConfig, ProcessResult, ParticipantOutput } from '../../src/types.js';

// Minimal concrete subclass for testing the abstract base
class TestParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string): CommandSpec {
    return { command: 'test-cli', args: ['--first', prompt] };
  }
  buildContinueCommand(prompt: string): CommandSpec {
    return { command: 'test-cli', args: ['--continue', prompt] };
  }
  parseOutput(result: ProcessResult): ParticipantOutput {
    return { response: result.stdout };
  }
}

function makeConfig(id: 'claude' | 'codex' | 'gemini', model?: string): ParticipantConfig {
  return { id, enabled: true, cliPath: id, model, timeoutMs: 5000 };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 10, ...overrides };
}

// ---------------------------------------------------------------------------
// buildCommand routing
// ---------------------------------------------------------------------------
describe('BaseParticipant.buildCommand', () => {
  test('calls buildFirstCommand when session not started', () => {
    const p = new TestParticipant(makeConfig('claude'));
    assert.equal(p.sessionStarted, false);
    const cmd = p.buildCommand('hello');
    assert.deepEqual(cmd.args, ['--first', 'hello']);
  });

  test('calls buildContinueCommand after sessionStarted is set', () => {
    const p = new TestParticipant(makeConfig('claude'));
    p.sessionStarted = true;
    const cmd = p.buildCommand('round 2');
    assert.deepEqual(cmd.args, ['--continue', 'round 2']);
  });
});

// ---------------------------------------------------------------------------
// isTokenLimitError
// ---------------------------------------------------------------------------
describe('BaseParticipant.isTokenLimitError', () => {
  const p = new TestParticipant(makeConfig('claude'));

  const knownMessages = [
    'context_length_exceeded',
    'context length exceeded',
    'context window size',
    'token limit reached',
    'max_tokens_exceeded',
    'maximum context exceeded',
    'too many tokens',
    'input too long',
    'prompt is too long',
    'resource_exhausted',
    'content too large',
    'request too large',
    'exceeds the model size',
  ];

  for (const msg of knownMessages) {
    test(`detects "${msg}" in stderr`, () => {
      assert.equal(p.isTokenLimitError(makeResult({ stderr: msg })), true);
    });
  }

  test('does NOT detect token limit phrase in stdout (avoids false positives on response content)', () => {
    // Response content may legitimately contain these phrases (e.g. when AIs
    // discuss a tool that has "token limit recovery" as a feature).
    assert.equal(p.isTokenLimitError(makeResult({ stdout: 'token limit exceeded' })), false);
  });

  test('returns false for an unrelated error message', () => {
    assert.equal(p.isTokenLimitError(makeResult({ stderr: 'network timeout' })), false);
  });

  test('returns false for empty output', () => {
    assert.equal(p.isTokenLimitError(makeResult()), false);
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------
describe('BaseParticipant.displayName', () => {
  test('returns correct name for claude', () => {
    assert.equal(new TestParticipant(makeConfig('claude')).displayName(), 'Claude (Anthropic)');
  });
  test('returns correct name for codex', () => {
    assert.equal(new TestParticipant(makeConfig('codex')).displayName(), 'Codex (OpenAI)');
  });
  test('returns correct name for gemini', () => {
    assert.equal(new TestParticipant(makeConfig('gemini')).displayName(), 'Gemini (Google)');
  });
});

// ---------------------------------------------------------------------------
// modelDisplay
// ---------------------------------------------------------------------------
describe('BaseParticipant.modelDisplay', () => {
  test('returns configured model name', () => {
    assert.equal(new TestParticipant(makeConfig('claude', 'claude-opus-4-6')).modelDisplay(), 'claude-opus-4-6');
  });

  test('returns "default" when no model is set', () => {
    assert.equal(new TestParticipant(makeConfig('claude')).modelDisplay(), 'default');
  });
});

// ---------------------------------------------------------------------------
// resetSession
// ---------------------------------------------------------------------------
describe('BaseParticipant.resetSession', () => {
  test('resets all session state fields', () => {
    const p = new TestParticipant(makeConfig('claude'));
    p.sessionStarted = true;
    p.sessionId = 'abc-123';
    p.lastFailureWasTokenLimit = true;

    p.resetSession();

    assert.equal(p.sessionStarted, false);
    assert.equal(p.sessionId, undefined);
    assert.equal(p.lastFailureWasTokenLimit, false);
  });
});

// ---------------------------------------------------------------------------
// cleanupCurrentPromptFile (Item 7B)
// ---------------------------------------------------------------------------
describe('BaseParticipant.cleanupCurrentPromptFile', () => {
  test('is a no-op by default — does not throw', () => {
    const p = new TestParticipant(makeConfig('claude'));
    // Should not throw even with no prompt file to clean up
    assert.doesNotThrow(() => p.cleanupCurrentPromptFile());
  });

  test('can be called multiple times without error', () => {
    const p = new TestParticipant(makeConfig('claude'));
    assert.doesNotThrow(() => {
      p.cleanupCurrentPromptFile();
      p.cleanupCurrentPromptFile();
    });
  });
});
