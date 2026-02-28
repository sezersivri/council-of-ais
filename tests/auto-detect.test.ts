import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoDetectModels } from '../src/auto-detect.js';
import type { MultiAiConfig, ParticipantConfig } from '../src/types.js';

function makeConfig(participants: ParticipantConfig[]): MultiAiConfig {
  return {
    maxRounds: 3,
    participants,
    outputDir: './output',
    outputFile: 'test.md',
    consensusThreshold: 1,
    verbose: false,
    watch: false,
    validateArtifacts: false,
    stream: false,
  };
}

function makeParticipant(overrides: Partial<ParticipantConfig> & { id: string }): ParticipantConfig {
  return {
    enabled: true,
    cliPath: overrides.id,
    timeoutMs: 60000,
    extraArgs: [],
    ...overrides,
  };
}

describe('autoDetectModels', () => {
  it('overrides model when detection succeeds', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'claude', model: 'old-model' }),
    ]);

    const detectFn = async () => 'claude-opus-4-6';
    const results = await autoDetectModels(config, detectFn);

    assert.equal(results.length, 1);
    assert.equal(results[0].participantId, 'claude');
    assert.equal(results[0].previousModel, 'old-model');
    assert.equal(results[0].detectedModel, 'claude-opus-4-6');
    // Config mutated in place
    assert.equal(config.participants[0].model, 'claude-opus-4-6');
  });

  it('keeps original model when detection returns null', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'gemini', model: 'gemini-2.5-pro' }),
    ]);

    const detectFn = async () => null;
    const results = await autoDetectModels(config, detectFn);

    assert.equal(results.length, 1);
    assert.equal(results[0].detectedModel, null);
    // Original model unchanged
    assert.equal(config.participants[0].model, 'gemini-2.5-pro');
  });

  it('skips generic participants', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'claude', model: 'old' }),
      makeParticipant({ id: 'llama3', type: 'generic', model: 'llama3' }),
    ]);

    const calls: string[] = [];
    const detectFn = async (id: string) => {
      calls.push(id);
      return 'detected-model';
    };

    const results = await autoDetectModels(config, detectFn);

    assert.equal(results.length, 1);
    assert.equal(results[0].participantId, 'claude');
    assert.deepEqual(calls, ['claude']);
    // Generic participant model untouched
    assert.equal(config.participants[1].model, 'llama3');
  });

  it('skips disabled participants', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'claude', enabled: false, model: 'old' }),
      makeParticipant({ id: 'codex', model: 'old' }),
    ]);

    const calls: string[] = [];
    const detectFn = async (id: string) => {
      calls.push(id);
      return 'best-model';
    };

    const results = await autoDetectModels(config, detectFn);

    assert.equal(results.length, 1);
    assert.equal(results[0].participantId, 'codex');
    assert.deepEqual(calls, ['codex']);
  });

  it('probes all built-in participants in parallel', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'claude', model: 'c-old' }),
      makeParticipant({ id: 'codex', model: 'x-old' }),
      makeParticipant({ id: 'gemini', model: 'g-old' }),
    ]);

    const detectFn = async (id: string) => `${id}-best`;
    const results = await autoDetectModels(config, detectFn);

    assert.equal(results.length, 3);
    assert.equal(config.participants[0].model, 'claude-best');
    assert.equal(config.participants[1].model, 'codex-best');
    assert.equal(config.participants[2].model, 'gemini-best');
  });

  it('returns empty array when no built-in participants are present', async () => {
    const config = makeConfig([
      makeParticipant({ id: 'llama3', type: 'generic' }),
    ]);

    const results = await autoDetectModels(config, async () => 'model');
    assert.deepEqual(results, []);
  });
});
