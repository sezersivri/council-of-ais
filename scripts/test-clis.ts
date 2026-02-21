/**
 * Isolated CLI smoke test.
 * Sends a trivial prompt to each participant and checks for a real response.
 * Run from a clean terminal (outside Claude Code) before starting a discussion.
 *
 *   npx tsx scripts/test-clis.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCliProcess, stripAnsi } from '../src/process-runner.js';
import { ClaudeParticipant } from '../src/participants/claude.js';
import { CodexParticipant } from '../src/participants/codex.js';
import { GeminiParticipant } from '../src/participants/gemini.js';
import type { ParticipantConfig } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config.self-review.json');
const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

const PROMPT = 'Reply with exactly one word: PONG';
const TIMEOUT = 30000;

// ── helpers ────────────────────────────────────────────────────────────────

function ok(msg: string)   { process.stdout.write(`  \x1b[32m✔\x1b[0m  ${msg}\n`); }
function fail(msg: string) { process.stdout.write(`  \x1b[31m✘\x1b[0m  ${msg}\n`); }
function info(msg: string) { process.stdout.write(`  \x1b[90m${msg}\x1b[0m\n`); }

// ── per-participant tests ───────────────────────────────────────────────────

async function testClaude(cfg: ParticipantConfig): Promise<boolean> {
  const p = new ClaudeParticipant(cfg);
  const { command, args, stdinData, env } = p.buildFirstCommand(PROMPT);
  const result = await runCliProcess(command, args, { cwd: process.cwd(), timeoutMs: TIMEOUT, stdinData, env });

  if (result.timedOut) { fail(`claude: timed out`); return false; }

  const output = p.parseOutput(result);
  if (!output.response) { fail(`claude: empty response (exit ${result.exitCode})`); info(stripAnsi(result.stderr).slice(0, 300)); return false; }

  ok(`claude [${cfg.model}]: ${output.response.slice(0, 80).replace(/\n/g, ' ')}`);
  return true;
}

async function testCodex(cfg: ParticipantConfig): Promise<boolean> {
  const p = new CodexParticipant(cfg);
  const { command, args, stdinData } = p.buildFirstCommand(PROMPT);
  const result = await runCliProcess(command, args, { cwd: process.cwd(), timeoutMs: TIMEOUT, stdinData });

  if (result.timedOut) { fail(`codex: timed out`); return false; }

  const output = p.parseOutput(result);
  if (!output.response) { fail(`codex: empty response (exit ${result.exitCode})`); info(stripAnsi(result.stderr).slice(0, 300)); return false; }

  ok(`codex  [${cfg.model}]: ${output.response.slice(0, 80).replace(/\n/g, ' ')}`);
  return true;
}

async function testGemini(cfg: ParticipantConfig): Promise<boolean> {
  const p = new GeminiParticipant(cfg);
  const { command, args, stdinData, env } = p.buildFirstCommand(PROMPT);
  const result = await runCliProcess(command, args, { cwd: process.cwd(), timeoutMs: TIMEOUT, stdinData, env });

  if (result.timedOut) { fail(`gemini: timed out`); return false; }

  const output = p.parseOutput(result);
  if (!output.response) { fail(`gemini: empty response (exit ${result.exitCode})`); info(stripAnsi(result.stderr).slice(0, 300)); return false; }

  ok(`gemini [${cfg.model}]: ${output.response.slice(0, 80).replace(/\n/g, ' ')}`);
  return true;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write('\nCLI smoke test — sending "PONG" prompt to each participant\n');
  process.stdout.write(`Config: config.self-review.json\n\n`);

  const participants: ParticipantConfig[] = rawConfig.participants;
  const results: Record<string, boolean> = {};

  for (const cfg of participants) {
    if (!cfg.enabled) { info(`${cfg.id}: skipped (disabled)`); continue; }
    process.stdout.write(`  Testing ${cfg.id} (${cfg.model})...\n`);

    try {
      if (cfg.id === 'claude')  results.claude  = await testClaude(cfg);
      if (cfg.id === 'codex')   results.codex   = await testCodex(cfg);
      if (cfg.id === 'gemini')  results.gemini  = await testGemini(cfg);
    } catch (err) {
      fail(`${cfg.id}: unexpected error — ${err instanceof Error ? err.message : err}`);
      results[cfg.id] = false;
    }
  }

  const passed = Object.values(results).filter(Boolean).length;
  const total  = Object.keys(results).length;

  process.stdout.write(`\n${passed}/${total} participants ready.\n`);

  if (passed < 2) {
    process.stdout.write('\x1b[31mNeed at least 2 working participants to run a discussion.\x1b[0m\n\n');
    process.exit(1);
  }

  if (passed < total) {
    process.stdout.write('\x1b[33mSome participants failed. Disable them in config.self-review.json before running.\x1b[0m\n\n');
  } else {
    process.stdout.write('\x1b[32mAll good — run: npm run self-review\x1b[0m\n\n');
  }
}

main();
