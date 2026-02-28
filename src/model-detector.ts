import { runCliProcess } from './process-runner.js';
import { ClaudeParticipant } from './participants/claude.js';
import { CodexParticipant } from './participants/codex.js';
import { GeminiParticipant } from './participants/gemini.js';
import type { ParticipantId, ParticipantConfig } from './types.js';

const PROBE_PROMPT = 'Reply with one word: PONG';
const PROBE_TIMEOUT = 60000;

/**
 * Ordered from most capable to least. First available wins.
 */
export const MODEL_PRIORITY: Record<ParticipantId, string[]> = {
  claude: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  codex: [
    'gpt-5.3-codex',
    'o4-mini',
    'gpt-4.1',
    'gpt-4o',
  ],
  gemini: [
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
  ],
};

function isModelError(stderr: string): boolean {
  const patterns = [
    'modelnotfounderror',
    'model not found',
    'requested entity was not found',
    'invalid model',
    'unknown model',
    'no such model',
    'does not exist',
  ];
  const lower = stderr.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

async function probeModel(
  participantId: ParticipantId,
  cliPath: string,
  model: string,
): Promise<boolean> {
  const cfg: ParticipantConfig = {
    id: participantId,
    enabled: true,
    cliPath,
    model,
    timeoutMs: PROBE_TIMEOUT,
    extraArgs: [],
  };

  let command: string;
  let args: string[];
  let stdinData: string | undefined;
  let env: Record<string, string | undefined> | undefined;

  if (participantId === 'claude') {
    const p = new ClaudeParticipant(cfg);
    ({ command, args, stdinData, env } = p.buildFirstCommand(PROBE_PROMPT));
  } else if (participantId === 'codex') {
    const p = new CodexParticipant(cfg);
    ({ command, args, stdinData } = p.buildFirstCommand(PROBE_PROMPT));
  } else {
    const p = new GeminiParticipant(cfg);
    ({ command, args, stdinData, env } = p.buildFirstCommand(PROBE_PROMPT));
  }

  const result = await runCliProcess(command, args, {
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT,
    stdinData,
    env,
  });

  if (result.timedOut) return false;
  if (isModelError(result.stderr)) return false;
  if (result.exitCode !== 0 && !result.stdout.trim()) return false;

  return true;
}

/**
 * Probes each model in priority order and returns the first one that works.
 * Returns null if none of the models respond successfully.
 */
export async function detectBestModel(
  participantId: ParticipantId,
  cliPath: string,
): Promise<string | null> {
  const models = MODEL_PRIORITY[participantId];

  for (const model of models) {
    const works = await probeModel(participantId, cliPath, model);
    if (works) return model;
  }

  return null;
}
