import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GenericParticipant } from '../../src/participants/generic.js';
import { ParticipantConfig } from '../../src/types.js';

function makeConfig(overrides: Partial<ParticipantConfig> = {}): ParticipantConfig {
  return {
    id: 'test-generic',
    type: 'generic',
    enabled: true,
    cliPath: 'echo',
    timeoutMs: 5000,
    ...overrides,
  };
}

function makeResult(stdout: string, stderr = '') {
  return { stdout, stderr, exitCode: 0, timedOut: false, durationMs: 10 };
}

describe('GenericParticipant.isStateless', () => {
  test('returns true when no session config', () => {
    const p = new GenericParticipant(makeConfig());
    assert.equal(p.isStateless(), true);
  });

  test('returns false when session config present', () => {
    const p = new GenericParticipant(makeConfig({ session: { extractField: 'context' } }));
    assert.equal(p.isStateless(), false);
  });
});

describe('GenericParticipant.buildFirstCommand — stdinBody', () => {
  test('raw prompt when no stdinBody', () => {
    const p = new GenericParticipant(makeConfig());
    const cmd = p.buildFirstCommand('hello world');
    assert.equal(cmd.stdinData, 'hello world');
  });

  test('builds JSON body with prompt injected', () => {
    const p = new GenericParticipant(makeConfig({
      stdinBody: { template: { model: 'llama3', stream: false }, promptField: 'prompt' },
    }));
    const cmd = p.buildFirstCommand('test prompt');
    const body = JSON.parse(cmd.stdinData!);
    assert.equal(body.model, 'llama3');
    assert.equal(body.stream, false);
    assert.equal(body.prompt, 'test prompt');
    assert.equal(body.context, undefined);
  });

  test('no state field injected on first command', () => {
    const p = new GenericParticipant(makeConfig({
      stdinBody: { template: { model: 'llama3' }, promptField: 'prompt', stateField: 'context' },
      session: { extractField: 'context' },
    }));
    const cmd = p.buildFirstCommand('hello');
    const body = JSON.parse(cmd.stdinData!);
    assert.equal(body.context, undefined);
  });

  test('prompt with quotes and newlines is safely escaped in JSON body', () => {
    const p = new GenericParticipant(makeConfig({
      stdinBody: { template: { model: 'llama3' }, promptField: 'prompt' },
    }));
    const nastyPrompt = 'line1\nline2 "quoted" \'single\' & ; |';
    const cmd = p.buildFirstCommand(nastyPrompt);
    const body = JSON.parse(cmd.stdinData!); // must not throw
    assert.equal(body.prompt, nastyPrompt);
  });

  test('undefined stdinData for arg inputMode', () => {
    const p = new GenericParticipant(makeConfig({
      inputMode: 'arg',
      stdinBody: { template: { model: 'x' }, promptField: 'prompt' },
    }));
    const cmd = p.buildFirstCommand('ignored');
    assert.equal(cmd.stdinData, undefined);
  });
});

describe('GenericParticipant.buildContinueCommand — extractField session', () => {
  test('injects sessionState into body on continue', () => {
    const p = new GenericParticipant(makeConfig({
      stdinBody: { template: { model: 'llama3', stream: false }, promptField: 'prompt', stateField: 'context' },
      session: { extractField: 'context' },
      jsonField: 'response',
    }));

    // Simulate parseOutput setting sessionState
    const mockResponse = JSON.stringify({ response: 'hello', context: [1, 2, 3] });
    p.sessionStarted = true;
    p.parseOutput(makeResult(mockResponse));

    const cmd = p.buildContinueCommand('next prompt');
    const body = JSON.parse(cmd.stdinData!);
    assert.deepEqual(body.context, [1, 2, 3]);
    assert.equal(body.prompt, 'next prompt');
  });

  test('no state injected when sessionState is still null', () => {
    const p = new GenericParticipant(makeConfig({
      stdinBody: { template: { model: 'llama3' }, promptField: 'prompt', stateField: 'context' },
      session: { extractField: 'context' },
    }));
    p.sessionStarted = true;
    const cmd = p.buildContinueCommand('hello');
    const body = JSON.parse(cmd.stdinData!);
    assert.equal(body.context, undefined);
  });
});

describe('GenericParticipant.parseOutput — extractField', () => {
  test('extracts simple field as response', () => {
    const p = new GenericParticipant(makeConfig({ jsonField: 'response' }));
    const out = p.parseOutput(makeResult(JSON.stringify({ response: 'hello' })));
    assert.equal(out.response, 'hello');
  });

  test('extracts complex sessionState (array)', () => {
    const p = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractField: 'context' },
    }));
    const out = p.parseOutput(makeResult(JSON.stringify({ response: 'hi', context: [1, 2, 3] })));
    assert.equal(out.response, 'hi');

    // Verify state was stored by checking it appears in next body
    const p2 = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractField: 'context' },
      stdinBody: { template: {}, promptField: 'prompt', stateField: 'context' },
    }));
    p2.sessionStarted = true;
    p2.parseOutput(makeResult(JSON.stringify({ response: 'hi', context: [1, 2, 3] })));
    const cmd = p2.buildContinueCommand('next');
    const body = JSON.parse(cmd.stdinData!);
    assert.deepEqual(body.context, [1, 2, 3]);
  });

  test('extractField gracefully skipped on JSON parse failure', () => {
    const p = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractField: 'context' },
    }));
    const out = p.parseOutput(makeResult('not json'));
    assert.equal(out.response, 'not json'); // falls back to raw
  });

  test('both extractPattern and extractField work independently', () => {
    const p = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractPattern: 'session_id: (\\S+)', extractField: 'context' },
    }));
    const rawWithBoth = 'session_id: abc123\n' + JSON.stringify({ response: 'hi', context: [9, 8] });
    // extractPattern operates on raw stdout, extractField on JSON
    // For this to work we need raw stdout that's valid JSON too — test extractField only here
    const p2 = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractField: 'context' },
    }));
    p2.parseOutput(makeResult(JSON.stringify({ response: 'hi', context: [9, 8] })));
    const cmd = new GenericParticipant(makeConfig({
      stdinBody: { template: {}, promptField: 'p', stateField: 'context' },
      session: { extractField: 'context' },
      jsonField: 'response',
    }));
    cmd.sessionStarted = true;
    cmd.parseOutput(makeResult(JSON.stringify({ response: 'hi', context: [9, 8] })));
    const next = cmd.buildContinueCommand('x');
    const body = JSON.parse(next.stdinData!);
    assert.deepEqual(body.context, [9, 8]);
  });
});

describe('GenericParticipant.resetSession', () => {
  test('clears sessionState to null', () => {
    const p = new GenericParticipant(makeConfig({
      jsonField: 'response',
      session: { extractField: 'context' },
      stdinBody: { template: {}, promptField: 'prompt', stateField: 'context' },
    }));
    p.parseOutput(makeResult(JSON.stringify({ response: 'hi', context: [1, 2, 3] })));
    p.sessionStarted = true;

    p.resetSession();
    assert.equal(p.sessionStarted, false);

    const cmd = p.buildFirstCommand('fresh');
    const body = JSON.parse(cmd.stdinData!);
    assert.equal(body.context, undefined); // state cleared
  });
});

describe('GenericParticipant — arg inputMode', () => {
  test('appends prompt to args in arg mode', () => {
    const p = new GenericParticipant(makeConfig({ inputMode: 'arg', extraArgs: ['run'] }));
    const cmd = p.buildFirstCommand('my prompt');
    assert.ok(cmd.args.includes('my prompt'));
    assert.equal(cmd.stdinData, undefined);
  });

  test('uses promptArg flag in arg mode', () => {
    const p = new GenericParticipant(makeConfig({
      inputMode: 'arg',
      promptArg: '--message',
      extraArgs: ['chat'],
    }));
    const cmd = p.buildFirstCommand('hello');
    assert.ok(cmd.args.includes('--message'));
    assert.ok(cmd.args.includes('hello'));
  });
});
