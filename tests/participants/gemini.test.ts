import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiParticipant } from '../../src/participants/gemini.js';
import type { ParticipantConfig, ProcessResult } from '../../src/types.js';

function makeConfig(overrides: Partial<ParticipantConfig> = {}): ParticipantConfig {
  return { id: 'gemini', enabled: true, cliPath: 'gemini', timeoutMs: 5000, extraArgs: [], ...overrides };
}

function makeResult(stdout: string, stderr = ''): ProcessResult {
  return { stdout, stderr, exitCode: 0, timedOut: false, durationMs: 100 };
}

// ---------------------------------------------------------------------------
// buildFirstCommand
// ---------------------------------------------------------------------------
describe('GeminiParticipant.buildFirstCommand', () => {
  test('returns gemini as the command', () => {
    const cmd = new GeminiParticipant(makeConfig()).buildFirstCommand('hi');
    assert.equal(cmd.command, 'gemini');
  });

  test('passes prompt as stdinData', () => {
    const cmd = new GeminiParticipant(makeConfig()).buildFirstCommand('my prompt');
    assert.equal(cmd.stdinData, 'my prompt');
  });

  test('sets GEMINI_MODEL env var when model is configured (not -m flag)', () => {
    const cmd = new GeminiParticipant(makeConfig({ model: 'gemini-3.1-pro-preview' })).buildFirstCommand('hi');
    assert.ok(!cmd.args.includes('-m'), 'should not use -m flag');
    assert.ok(cmd.env, 'env should be set');
    assert.equal(cmd.env!['GEMINI_MODEL'], 'gemini-3.1-pro-preview');
  });

  test('does not set GEMINI_MODEL when no model is configured', () => {
    const cmd = new GeminiParticipant(makeConfig({ model: undefined })).buildFirstCommand('hi');
    assert.ok(!cmd.env?.['GEMINI_MODEL']);
  });

  test('appends extraArgs', () => {
    const cmd = new GeminiParticipant(makeConfig({ extraArgs: ['--output-format', 'stream-json'] })).buildFirstCommand('hi');
    assert.ok(cmd.args.includes('--output-format'));
  });
});

// ---------------------------------------------------------------------------
// buildContinueCommand
// ---------------------------------------------------------------------------
describe('GeminiParticipant.buildContinueCommand', () => {
  test('uses --resume latest when no sessionId', () => {
    const p = new GeminiParticipant(makeConfig());
    const cmd = p.buildContinueCommand('round 2');
    assert.ok(cmd.args.includes('--resume'));
    assert.ok(cmd.args.includes('latest'));
  });

  test('uses --resume with sessionId when available', () => {
    const p = new GeminiParticipant(makeConfig());
    p.sessionId = 'gemini-sess-123';
    const cmd = p.buildContinueCommand('round 2');
    assert.ok(cmd.args.includes('--resume'));
    assert.ok(cmd.args.includes('gemini-sess-123'));
    assert.ok(!cmd.args.includes('latest'));
  });

  test('passes prompt as stdinData in continue command', () => {
    const p = new GeminiParticipant(makeConfig());
    const cmd = p.buildContinueCommand('continue msg');
    assert.equal(cmd.stdinData, 'continue msg');
  });

  test('sets GEMINI_MODEL env var in continue command', () => {
    const p = new GeminiParticipant(makeConfig({ model: 'gemini-3.1-pro-preview' }));
    const cmd = p.buildContinueCommand('round 2');
    assert.equal(cmd.env!['GEMINI_MODEL'], 'gemini-3.1-pro-preview');
    assert.ok(!cmd.args.includes('-m'));
  });
});

// ---------------------------------------------------------------------------
// parseOutput
// ---------------------------------------------------------------------------
describe('GeminiParticipant.parseOutput', () => {
  test('returns plain text when output has no JSON', () => {
    const p = new GeminiParticipant(makeConfig());
    const output = p.parseOutput(makeResult('plain gemini response'));
    assert.equal(output.response, 'plain gemini response');
  });

  test('extracts text from JSON line with text field', () => {
    const p = new GeminiParticipant(makeConfig());
    const jsonl = JSON.stringify({ text: 'JSON text response', session_id: 'g-sess-1' });
    const output = p.parseOutput(makeResult(jsonl));
    assert.equal(output.response, 'JSON text response');
    assert.equal(output.sessionId, 'g-sess-1');
  });

  test('concatenates multiple text chunks from JSONL', () => {
    const p = new GeminiParticipant(makeConfig());
    const lines = [
      JSON.stringify({ text: 'Hello ' }),
      JSON.stringify({ text: 'world' }),
    ].join('\n');
    const output = p.parseOutput(makeResult(lines));
    assert.equal(output.response, 'Hello world');
  });

  test('returns result field directly and short-circuits', () => {
    const p = new GeminiParticipant(makeConfig());
    const jsonl = JSON.stringify({ result: 'Final result', session_id: 'g-sess-2' });
    const output = p.parseOutput(makeResult(jsonl));
    assert.equal(output.response, 'Final result');
    assert.equal(output.sessionId, 'g-sess-2');
  });

  test('treats JSON without known fields as plain text', () => {
    const p = new GeminiParticipant(makeConfig());
    const line = JSON.stringify({ unknown_field: 'value' });
    const output = p.parseOutput(makeResult(line));
    assert.equal(output.response, line);
  });

  test('strips ANSI escape codes', () => {
    const p = new GeminiParticipant(makeConfig());
    const output = p.parseOutput(makeResult('\x1b[34mblue text\x1b[0m'));
    assert.equal(output.response, 'blue text');
  });

  test('captures sessionId from JSON without text/result', () => {
    const p = new GeminiParticipant(makeConfig());
    const lines = [
      JSON.stringify({ session_id: 'g-sess-3', status: 'ready' }),
      JSON.stringify({ text: 'Response text' }),
    ].join('\n');
    const output = p.parseOutput(makeResult(lines));
    assert.equal(output.sessionId, 'g-sess-3');
    assert.equal(output.response, 'Response text');
  });
});
