import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

function writeTmp(data: unknown): string {
  const path = join(tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(data), 'utf-8');
  return path;
}

describe('loadConfig', () => {
  test('returns sensible defaults when config file does not exist', () => {
    const config = loadConfig('/nonexistent/path/no-config.json', {});
    assert.equal(config.maxRounds, 5);
    assert.equal(config.outputFile, 'discussion.md');
    assert.equal(config.verbose, false);
    assert.equal(config.watch, false);
    assert.equal(config.validateArtifacts, false);
    assert.equal(config.stream, false);
    assert.equal(config.consensusThreshold, 1);
  });

  test('applies CLI overrides over defaults', () => {
    const config = loadConfig('/nonexistent', { maxRounds: 10, verbose: true, watch: true });
    assert.equal(config.maxRounds, 10);
    assert.equal(config.verbose, true);
    assert.equal(config.watch, true);
  });

  test('reads values from a custom config file', () => {
    const path = writeTmp({ maxRounds: 7, consensusThreshold: 2, outputDir: './custom-output' });
    try {
      const config = loadConfig(path, {});
      assert.equal(config.maxRounds, 7);
      assert.equal(config.consensusThreshold, 2);
      assert.equal(config.outputDir, './custom-output');
    } finally {
      try { rmSync(path); } catch { /* ignore */ }
    }
  });

  test('CLI overrides take precedence over file values', () => {
    const path = writeTmp({ maxRounds: 7 });
    try {
      const config = loadConfig(path, { maxRounds: 3 });
      assert.equal(config.maxRounds, 3);
    } finally {
      try { rmSync(path); } catch { /* ignore */ }
    }
  });

  test('always returns all 3 participants', () => {
    const config = loadConfig('/nonexistent', {});
    assert.equal(config.participants.length, 3);
    const ids = config.participants.map((p) => p.id).sort();
    assert.deepEqual(ids, ['claude', 'codex', 'gemini']);
  });

  test('disables non-active participants when participants filter is provided', () => {
    const config = loadConfig('/nonexistent', { participants: ['claude'] });
    const enabled = config.participants.filter((p) => p.enabled);
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].id, 'claude');
  });

  test('enables all participants when no filter is provided', () => {
    const config = loadConfig('/nonexistent', {});
    assert.ok(config.participants.every((p) => p.enabled));
  });

  test('merges participant config from file into defaults', () => {
    const path = writeTmp({
      participants: [{ id: 'claude', timeoutMs: 99999, model: 'custom-model' }],
    });
    try {
      const config = loadConfig(path, {});
      const claude = config.participants.find((p) => p.id === 'claude');
      assert.ok(claude);
      assert.equal(claude.timeoutMs, 99999);
      assert.equal(claude.model, 'custom-model');
      // other fields should still be present
      assert.equal(claude.cliPath, 'claude');
    } finally {
      try { rmSync(path); } catch { /* ignore */ }
    }
  });

  test('validateArtifacts and stream default to false regardless of config file', () => {
    const path = writeTmp({});
    try {
      const config = loadConfig(path, {});
      assert.equal(config.validateArtifacts, false);
      assert.equal(config.stream, false);
    } finally {
      try { rmSync(path); } catch { /* ignore */ }
    }
  });
});
