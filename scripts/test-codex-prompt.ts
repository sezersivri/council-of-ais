/**
 * Isolated Codex diagnostic — sends the actual Round 1 self-review prompt
 * with different reasoning_effort levels and reports what happens.
 *
 *   npx tsx scripts/test-codex-prompt.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCliProcess } from '../src/process-runner.js';
import { buildInitialPrompt } from '../src/prompt-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const topic = readFileSync(join(root, 'topics/self-review.md'), 'utf-8');
const prompt = buildInitialPrompt(topic, 'codex', 1, 4);

console.log(`\nPrompt: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)\n`);

const levels = ['medium', 'high', 'xhigh'];

for (const level of levels) {
  process.stdout.write(`Testing reasoning_effort="${level}" ... `);

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--ephemeral',
    '-m', 'gpt-5.3-codex',
    '-c', `model_reasoning_effort="${level}"`,
  ];

  const start = Date.now();
  const result = await runCliProcess('codex', args, {
    cwd: root,
    timeoutMs: 120000,
    stdinData: prompt,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.timedOut) {
    console.log(`TIMED OUT (${elapsed}s)`);
  } else {
    console.log(`exit=${result.exitCode} (${elapsed}s)`);
    console.log(`  stdout (${result.stdout.length} chars): "${result.stdout.trim().slice(0, 200).replace(/\n/g, ' ')}"`);
    console.log(`  stderr (${result.stderr.length} chars): "${result.stderr.trim().slice(0, 400).replace(/\n/g, ' ')}"`);
  }
}
