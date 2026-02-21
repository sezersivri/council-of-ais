import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeParticipant } from '../../src/participants/claude.js';
import type { ParticipantConfig, ProcessResult } from '../../src/types.js';

function makeConfig(overrides: Partial<ParticipantConfig> = {}): ParticipantConfig {
  return { id: 'claude', enabled: true, cliPath: 'claude', timeoutMs: 5000, extraArgs: [], ...overrides };
}

function makeResult(stdout: string, stderr = ''): ProcessResult {
  return { stdout, stderr, exitCode: 0, timedOut: false, durationMs: 100 };
}

// ---------------------------------------------------------------------------
// buildFirstCommand
// ---------------------------------------------------------------------------
describe('ClaudeParticipant.buildFirstCommand', () => {
  test('returns claude as the command', () => {
    const cmd = new ClaudeParticipant(makeConfig()).buildFirstCommand('hi');
    assert.equal(cmd.command, 'claude');
  });

  test('calling buildFirstCommand twice does not throw (pre-clean guard)', () => {
    // Item 7A: buildFirstCommand cleans up the previous temp file before writing.
    // Calling it twice in sequence must not throw even if the first file no longer exists.
    const p = new ClaudeParticipant(makeConfig());
    assert.doesNotThrow(() => {
      p.buildFirstCommand('first prompt');
      p.buildFirstCommand('second prompt');
    });
  });

  test('always includes -p and --output-format json', () => {
    const cmd = new ClaudeParticipant(makeConfig()).buildFirstCommand('hi');
    assert.ok(cmd.args.includes('-p'));
    assert.ok(cmd.args.includes('--output-format'));
    assert.ok(cmd.args.includes('json'));
  });

  test('passes prompt as stdinData', () => {
    const cmd = new ClaudeParticipant(makeConfig()).buildFirstCommand('my prompt');
    assert.equal(cmd.stdinData, 'my prompt');
  });

  test('includes --model flag when model is configured', () => {
    const cmd = new ClaudeParticipant(makeConfig({ model: 'claude-opus-4-6' })).buildFirstCommand('hi');
    const idx = cmd.args.indexOf('--model');
    assert.ok(idx !== -1, '--model flag not found');
    assert.equal(cmd.args[idx + 1], 'claude-opus-4-6');
  });

  test('omits --model flag when no model is configured', () => {
    const cmd = new ClaudeParticipant(makeConfig({ model: undefined })).buildFirstCommand('hi');
    assert.ok(!cmd.args.includes('--model'));
  });

  test('appends extraArgs', () => {
    const cmd = new ClaudeParticipant(makeConfig({ extraArgs: ['--verbose', '--debug'] })).buildFirstCommand('hi');
    assert.ok(cmd.args.includes('--verbose'));
    assert.ok(cmd.args.includes('--debug'));
  });

  test('includes CLAUDE env cleanup keys', () => {
    const cmd = new ClaudeParticipant(makeConfig()).buildFirstCommand('hi');
    assert.ok(cmd.env);
    assert.ok('CLAUDECODE' in cmd.env!);
    assert.ok('CLAUDE_CODE' in cmd.env!);
  });
});

// ---------------------------------------------------------------------------
// cleanupCurrentPromptFile (Item 7B override)
// ---------------------------------------------------------------------------
describe('ClaudeParticipant.cleanupCurrentPromptFile', () => {
  test('does not throw when no prompt file has been written', () => {
    const p = new ClaudeParticipant(makeConfig());
    assert.doesNotThrow(() => p.cleanupCurrentPromptFile());
  });

  test('does not throw when called after buildFirstCommand', () => {
    const p = new ClaudeParticipant(makeConfig());
    p.buildFirstCommand('some prompt');
    assert.doesNotThrow(() => p.cleanupCurrentPromptFile());
  });
});

// ---------------------------------------------------------------------------
// buildContinueCommand
// ---------------------------------------------------------------------------
describe('ClaudeParticipant.buildContinueCommand', () => {
  test('uses --continue when no sessionId', () => {
    const p = new ClaudeParticipant(makeConfig());
    const cmd = p.buildContinueCommand('round 2');
    assert.ok(cmd.args.includes('--continue'));
    assert.ok(!cmd.args.includes('--resume'));
  });

  test('uses --resume with sessionId when available', () => {
    const p = new ClaudeParticipant(makeConfig());
    p.sessionId = 'sess-abc123';
    const cmd = p.buildContinueCommand('round 2');
    assert.ok(cmd.args.includes('--resume'));
    assert.ok(cmd.args.includes('sess-abc123'));
    assert.ok(!cmd.args.includes('--continue'));
  });

  test('includes -p and --output-format json in continue command', () => {
    const cmd = new ClaudeParticipant(makeConfig()).buildContinueCommand('hi');
    assert.ok(cmd.args.includes('-p'));
    assert.ok(cmd.args.includes('--output-format'));
    assert.ok(cmd.args.includes('json'));
  });
});

// ---------------------------------------------------------------------------
// isTokenLimitError
// ---------------------------------------------------------------------------
describe('ClaudeParticipant.isTokenLimitError', () => {
  const p = new ClaudeParticipant(makeConfig());

  test('detects token limit in stderr', () => {
    assert.equal(p.isTokenLimitError(makeResult('', 'context_length_exceeded')), true);
  });

  test('detects is_error JSON in stdout with context limit message', () => {
    const errJson = JSON.stringify({ is_error: true, result: 'context length exceeded' });
    assert.equal(p.isTokenLimitError(makeResult(errJson, '')), true);
  });

  test('does NOT false-positive on response content mentioning token limit', () => {
    const response = JSON.stringify({ result: 'The token limit recovery feature resets the session context window' });
    assert.equal(p.isTokenLimitError(makeResult(response, '')), false);
  });
});

// ---------------------------------------------------------------------------
// parseOutput
// ---------------------------------------------------------------------------
describe('ClaudeParticipant.parseOutput', () => {
  test('extracts response from JSON result field', () => {
    const p = new ClaudeParticipant(makeConfig());
    const output = p.parseOutput(makeResult(JSON.stringify({ result: 'Hello from Claude', session_id: 'sess-1' })));
    assert.equal(output.response, 'Hello from Claude');
    assert.equal(output.sessionId, 'sess-1');
  });

  test('extracts response from JSON content field when result is absent', () => {
    const p = new ClaudeParticipant(makeConfig());
    const output = p.parseOutput(makeResult(JSON.stringify({ content: 'Content field value' })));
    assert.equal(output.response, 'Content field value');
  });

  test('falls back to raw stdout when JSON parsing fails', () => {
    const p = new ClaudeParticipant(makeConfig());
    const output = p.parseOutput(makeResult('plain text response'));
    assert.equal(output.response, 'plain text response');
  });

  test('strips ANSI escape codes', () => {
    const p = new ClaudeParticipant(makeConfig());
    const output = p.parseOutput(makeResult('\x1b[32mcolored\x1b[0m'));
    assert.equal(output.response, 'colored');
  });

  test('sessionId is undefined when JSON has no session_id', () => {
    const p = new ClaudeParticipant(makeConfig());
    const output = p.parseOutput(makeResult(JSON.stringify({ result: 'ok' })));
    assert.equal(output.sessionId, undefined);
  });
});
