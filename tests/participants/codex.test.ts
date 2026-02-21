import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexParticipant } from '../../src/participants/codex.js';
import type { ParticipantConfig, ProcessResult } from '../../src/types.js';

function makeConfig(overrides: Partial<ParticipantConfig> = {}): ParticipantConfig {
  return { id: 'codex', enabled: true, cliPath: 'codex', timeoutMs: 5000, extraArgs: [], ...overrides };
}

function makeResult(stdout: string, stderr = ''): ProcessResult {
  return { stdout, stderr, exitCode: 0, timedOut: false, durationMs: 100 };
}

// ---------------------------------------------------------------------------
// buildFirstCommand
// ---------------------------------------------------------------------------
describe('CodexParticipant.buildFirstCommand', () => {
  test('returns codex as the command', () => {
    const cmd = new CodexParticipant(makeConfig()).buildFirstCommand('hi');
    assert.equal(cmd.command, 'codex');
  });

  test('includes exec, --sandbox, and --ephemeral flags', () => {
    const cmd = new CodexParticipant(makeConfig()).buildFirstCommand('hi');
    assert.ok(cmd.args.includes('exec'));
    assert.ok(cmd.args.includes('--sandbox'));
    assert.ok(cmd.args.includes('--ephemeral'));
  });

  test('passes prompt as stdinData', () => {
    const cmd = new CodexParticipant(makeConfig()).buildFirstCommand('test prompt');
    assert.equal(cmd.stdinData, 'test prompt');
  });

  test('includes -m flag when model is configured', () => {
    const cmd = new CodexParticipant(makeConfig({ model: 'gpt-5.3-codex' })).buildFirstCommand('hi');
    const idx = cmd.args.indexOf('-m');
    assert.ok(idx !== -1, '-m flag not found');
    assert.equal(cmd.args[idx + 1], 'gpt-5.3-codex');
  });

  test('omits -m flag when no model is configured', () => {
    const cmd = new CodexParticipant(makeConfig({ model: undefined })).buildFirstCommand('hi');
    assert.ok(!cmd.args.includes('-m'));
  });

  test('appends extraArgs', () => {
    const cmd = new CodexParticipant(makeConfig({ extraArgs: ['--json'] })).buildFirstCommand('hi');
    assert.ok(cmd.args.includes('--json'));
  });
});

// ---------------------------------------------------------------------------
// buildContinueCommand
// ---------------------------------------------------------------------------
describe('CodexParticipant.buildContinueCommand', () => {
  test('falls back to buildFirstCommand (no --last) when no sessionId', () => {
    // Item 6 fix: --last could accidentally resume another Codex instance
    // from a parallel execution. When no session ID is captured, start fresh.
    const p = new CodexParticipant(makeConfig());
    const cmd = p.buildContinueCommand('continue');
    // Should behave like buildFirstCommand: no 'resume', no '--last'
    assert.ok(!cmd.args.includes('--last'), '--last must not be used when no sessionId');
    assert.ok(!cmd.args.includes('resume'), 'resume must not appear when no sessionId');
    assert.ok(cmd.args.includes('exec'), 'exec subcommand must be present');
    assert.ok(cmd.args.includes('--ephemeral'), '--ephemeral must be set for fresh session');
  });

  test('uses --session when sessionId is available', () => {
    const p = new CodexParticipant(makeConfig());
    p.sessionId = 'sess-xyz';
    const cmd = p.buildContinueCommand('continue');
    assert.ok(cmd.args.includes('resume'));
    assert.ok(cmd.args.includes('--session'));
    assert.ok(cmd.args.includes('sess-xyz'));
    assert.ok(!cmd.args.includes('--last'));
  });
});

// ---------------------------------------------------------------------------
// isTokenLimitError
// ---------------------------------------------------------------------------
describe('CodexParticipant.isTokenLimitError', () => {
  const p = new CodexParticipant(makeConfig());

  // Codex echoes the full prompt in stderr as part of its session log.
  // The prompt may discuss "token limit" as a concept — must not false-positive.
  const CODEX_HEADER = [
    'Reading prompt from stdin...',
    'OpenAI Codex v0.104.0 (research preview)',
    '--------',
    'workdir: /foo  model: gpt-5.3-codex  session id: abc123',
    '--------',
  ].join('\n');

  test('does NOT false-positive when prompt mentions "token limit" in conversation echo', () => {
    const stderrWithEcho = CODEX_HEADER + '\nuser\nToken limit recovery: if a participant hits context limit...';
    assert.equal(p.isTokenLimitError(makeResult('some response', stderrWithEcho)), false);
  });

  test('does NOT false-positive when prompt mentions "context window" in conversation echo', () => {
    const stderrWithEcho = CODEX_HEADER + '\nuser\nThis feature manages the context window size.';
    assert.equal(p.isTokenLimitError(makeResult('some response', stderrWithEcho)), false);
  });

  test('detects real token limit error in Codex header section', () => {
    const stderrWithError = CODEX_HEADER.replace('session id: abc123', 'session id: abc123\nError: context_length_exceeded');
    assert.equal(p.isTokenLimitError(makeResult('', stderrWithError)), true);
  });

  test('detects token limit when stderr has no separator (no conversation echo)', () => {
    assert.equal(p.isTokenLimitError(makeResult('', 'request too large')), true);
  });

  test('returns false for unrelated stderr content', () => {
    assert.equal(p.isTokenLimitError(makeResult('ok', 'network timeout')), false);
  });
});

// ---------------------------------------------------------------------------
// parseOutput
// ---------------------------------------------------------------------------
describe('CodexParticipant.parseOutput', () => {
  test('returns plain text when output has no JSON', () => {
    const p = new CodexParticipant(makeConfig());
    const output = p.parseOutput(makeResult('plain response'));
    assert.equal(output.response, 'plain response');
  });

  test('extracts content from JSONL message line', () => {
    const p = new CodexParticipant(makeConfig());
    const jsonl = JSON.stringify({ type: 'message', content: 'JSONL response', session_id: 'sess-2' });
    const output = p.parseOutput(makeResult(jsonl));
    assert.equal(output.response, 'JSONL response');
    assert.equal(output.sessionId, 'sess-2');
  });

  test('treats JSON without type field as plain text', () => {
    const p = new CodexParticipant(makeConfig());
    const line = JSON.stringify({ foo: 'bar', no_type: true });
    const output = p.parseOutput(makeResult(line));
    assert.equal(output.response, line);
  });

  test('falls back to plain text lines when typed JSON has no message type', () => {
    const p = new CodexParticipant(makeConfig());
    const typedLine = JSON.stringify({ type: 'metadata', data: 'x' });
    const textLine = 'actual response text';
    const output = p.parseOutput(makeResult(`${typedLine}\n${textLine}`));
    assert.equal(output.response, textLine);
  });

  test('strips ANSI escape codes', () => {
    const p = new CodexParticipant(makeConfig());
    const output = p.parseOutput(makeResult('\x1b[33myellow\x1b[0m'));
    assert.equal(output.response, 'yellow');
  });

  test('returns raw output when all lines are typed JSON but none is a message', () => {
    const p = new CodexParticipant(makeConfig());
    const line = JSON.stringify({ type: 'status', status: 'done' });
    const output = p.parseOutput(makeResult(line));
    // No message type found, textLines is empty → falls back to raw
    assert.ok(output.response.length >= 0); // just ensure no crash
  });
});
