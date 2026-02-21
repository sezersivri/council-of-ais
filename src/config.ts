import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MultiAiConfig, ParticipantConfig, ParticipantId } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', 'config.default.json');

interface CliOverrides {
  maxRounds?: number;
  participants?: ParticipantId[];
  outputFile?: string;
  verbose?: boolean;
  watch?: boolean;
  validateArtifacts?: boolean;
  stream?: boolean;
}

export const RECOMMENDED_MODELS: Record<ParticipantId, string> = {
  claude: 'claude-opus-4-6',
  codex: 'gpt-5.3-codex',
  gemini: 'gemini-3.1-pro-preview',
};

const DEFAULT_PARTICIPANTS: Record<ParticipantId, ParticipantConfig> = {
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

export function loadConfig(configPath: string | undefined, overrides: CliOverrides): MultiAiConfig {
  let rawConfig: Record<string, unknown> = {};

  if (configPath && existsSync(configPath)) {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } else if (existsSync(DEFAULT_CONFIG_PATH)) {
    rawConfig = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
  }

  const configParticipants = rawConfig.participants as ParticipantConfig[] | undefined;

  return {
    maxRounds: overrides.maxRounds ?? (rawConfig.maxRounds as number) ?? 5,
    outputDir: (rawConfig.outputDir as string) ?? './output',
    outputFile: overrides.outputFile ?? (rawConfig.outputFile as string) ?? 'discussion.md',
    consensusThreshold: (rawConfig.consensusThreshold as number) ?? 1,
    verbose: overrides.verbose ?? (rawConfig.verbose as boolean) ?? false,
    watch: overrides.watch ?? (rawConfig.watch as boolean) ?? false,
    validateArtifacts: overrides.validateArtifacts ?? false,
    stream: overrides.stream ?? false,
    participants: buildParticipantConfigs(configParticipants, overrides.participants),
  };
}

function buildParticipantConfigs(
  configParticipants: ParticipantConfig[] | undefined,
  activeIds: ParticipantId[] | undefined,
): ParticipantConfig[] {
  const merged = { ...DEFAULT_PARTICIPANTS };

  if (configParticipants) {
    for (const cp of configParticipants) {
      if (merged[cp.id]) {
        merged[cp.id] = { ...merged[cp.id], ...cp };
      }
    }
  }

  if (activeIds) {
    for (const id of Object.keys(merged) as ParticipantId[]) {
      merged[id].enabled = activeIds.includes(id);
    }
  }

  return Object.values(merged);
}
