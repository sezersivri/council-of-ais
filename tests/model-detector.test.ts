import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PRIORITY } from '../src/model-detector.js';

describe('MODEL_PRIORITY', () => {
  it('has entries for all three built-in participant IDs', () => {
    assert.ok(MODEL_PRIORITY.claude, 'claude entry missing');
    assert.ok(MODEL_PRIORITY.codex, 'codex entry missing');
    assert.ok(MODEL_PRIORITY.gemini, 'gemini entry missing');
  });

  it('each list is non-empty', () => {
    for (const [id, models] of Object.entries(MODEL_PRIORITY)) {
      assert.ok(models.length > 0, `${id} model list is empty`);
    }
  });

  it('gemini-3.1-pro-preview is first in gemini list', () => {
    assert.equal(MODEL_PRIORITY.gemini[0], 'gemini-3.1-pro-preview');
  });

  it('claude-opus-4-6 is first in claude list', () => {
    assert.equal(MODEL_PRIORITY.claude[0], 'claude-opus-4-6');
  });

  it('gpt-5.3-codex is first in codex list', () => {
    assert.equal(MODEL_PRIORITY.codex[0], 'gpt-5.3-codex');
  });
});
