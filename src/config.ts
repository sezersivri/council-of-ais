import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { MultiAiConfig, ParticipantConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', 'config.default.json');
const CWD_CONFIG_NAME = 'multi-ai.json';

interface CliOverrides {
  maxRounds?: number;
  participants?: string[];
  outputFile?: string;
  verbose?: boolean;
  watch?: boolean;
  validateArtifacts?: boolean;
  stream?: boolean;
  dryRun?: boolean;
  independentDraft?: boolean;
  debug?: boolean;
  jsonReport?: string;
  ci?: boolean;
  projectGuidance?: string;
  skipPreflight?: boolean;
  auto?: boolean;
}

export const RECOMMENDED_MODELS: Record<string, string> = {
  claude: 'claude-opus-4-6',
  codex: 'gpt-5.3-codex',
  gemini: 'gemini-3.1-pro-preview',
};

const DEFAULT_PARTICIPANTS: Record<string, ParticipantConfig> = {
  claude: {
    id: 'claude',
    enabled: true,
    cliPath: 'claude',
    model: RECOMMENDED_MODELS.claude,
    timeoutMs: 120000,
    extraArgs: [],
  },
  codex: {
    id: 'codex',
    enabled: true,
    cliPath: 'codex',
    model: RECOMMENDED_MODELS.codex,
    timeoutMs: 120000,
    extraArgs: [],
  },
  gemini: {
    id: 'gemini',
    enabled: true,
    cliPath: 'gemini',
    model: RECOMMENDED_MODELS.gemini,
    timeoutMs: 120000,
    extraArgs: [],
  },
};

/**
 * Resolve a user-supplied path against `base` (CWD) and reject obvious
 * directory-traversal attacks. Paths that escape above the grandparent of
 * `base` are clamped to `<base>/output`. This allows sibling-project paths
 * like `../reports` while blocking `../../../../etc/hosts`.
 */
function safeResolvePath(base: string, userPath: string): string {
  const resolved = resolve(base, userPath);
  // Allow anything at or below the grandparent of CWD (two levels up).
  const cwdGrandparent = resolve(base, '../..');
  if (!resolved.startsWith(cwdGrandparent)) {
    return resolve(base, 'output');
  }
  return resolved;
}

/**
 * Clamp numeric config fields to safe ranges so that a malformed or
 * adversarial config cannot cause zero-round or near-infinite loops.
 */
function validateConfig(config: MultiAiConfig): void {
  if (!Number.isFinite(config.maxRounds) || config.maxRounds < 1) {
    config.maxRounds = 5;
  }
  config.maxRounds = Math.min(Math.max(Math.round(config.maxRounds), 1), 50);

  for (const p of config.participants) {
    if (!Number.isFinite(p.timeoutMs) || p.timeoutMs < 5000) {
      p.timeoutMs = 120000;
    }
    p.timeoutMs = Math.min(p.timeoutMs, 600000);
  }
}

export function loadConfig(configPath: string | undefined, overrides: CliOverrides): MultiAiConfig {
  let rawConfig: Record<string, unknown> = {};

  if (configPath && existsSync(configPath)) {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } else {
    // Auto-discover: check CWD for multi-ai.json first, then fall back to default
    const cwdConfig = join(process.cwd(), CWD_CONFIG_NAME);
    if (existsSync(cwdConfig)) {
      rawConfig = JSON.parse(readFileSync(cwdConfig, 'utf-8'));
    } else if (existsSync(DEFAULT_CONFIG_PATH)) {
      rawConfig = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
    }
  }

  const configParticipants = rawConfig.participants as ParticipantConfig[] | undefined;

  // --ci is a convenience alias: sets jsonReport default, enforces exit codes
  const isCi = overrides.ci ?? (rawConfig.ci as boolean) ?? false;

  const cwd = process.cwd();

  const rawOutputDir = (rawConfig.outputDir as string) ?? './output';
  const rawJsonReport = overrides.jsonReport ?? (rawConfig.jsonReport as string | undefined) ?? (isCi ? './result.json' : undefined);

  const result: MultiAiConfig = {
    maxRounds: overrides.maxRounds ?? (rawConfig.maxRounds as number) ?? 5,
    outputDir: safeResolvePath(cwd, rawOutputDir),
    outputFile: overrides.outputFile ?? (rawConfig.outputFile as string) ?? 'discussion.md',
    consensusThreshold: (rawConfig.consensusThreshold as number) ?? 1,
    verbose: overrides.verbose ?? (rawConfig.verbose as boolean) ?? false,
    watch: overrides.watch ?? (rawConfig.watch as boolean) ?? false,
    validateArtifacts: overrides.validateArtifacts ?? false,
    stream: overrides.stream ?? false,
    dryRun: overrides.dryRun ?? false,
    independentDraft: overrides.independentDraft ?? false,
    debug: overrides.debug ?? (rawConfig.debug as boolean) ?? false,
    jsonReport: rawJsonReport !== undefined ? safeResolvePath(cwd, rawJsonReport) : undefined,
    ci: isCi,
    projectGuidance: overrides.projectGuidance ?? (rawConfig.guidance as string | undefined),
    skipPreflight: overrides.skipPreflight ?? false,
    auto: overrides.auto ?? (rawConfig.auto as boolean) ?? false,
    participants: buildParticipantConfigs(configParticipants, overrides.participants),
  };

  validateConfig(result);
  return result;
}

function buildParticipantConfigs(
  configParticipants: ParticipantConfig[] | undefined,
  activeIds: string[] | undefined,
): ParticipantConfig[] {
  const merged: Record<string, ParticipantConfig> = { ...DEFAULT_PARTICIPANTS };

  if (configParticipants) {
    for (const cp of configParticipants) {
      if (merged[cp.id]) {
        // Override a built-in participant's settings
        merged[cp.id] = { ...merged[cp.id], ...cp };
      } else {
        // New participant (generic or otherwise) — add with sensible defaults
        merged[cp.id] = { ...cp, timeoutMs: cp.timeoutMs ?? 120000, enabled: cp.enabled ?? true };
      }
    }
  }

  if (activeIds) {
    for (const id of Object.keys(merged)) {
      merged[id].enabled = activeIds.includes(id);
    }
  }

  return Object.values(merged);
}
