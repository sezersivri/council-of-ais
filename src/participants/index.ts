import { ParticipantConfig } from '../types.js';
import { BaseParticipant } from './base.js';
import { ClaudeParticipant } from './claude.js';
import { CodexParticipant } from './codex.js';
import { GeminiParticipant } from './gemini.js';
import { GenericParticipant } from './generic.js';

const BUILTIN_FACTORIES: Record<string, new (config: ParticipantConfig) => BaseParticipant> = {
  claude: ClaudeParticipant,
  codex: CodexParticipant,
  gemini: GeminiParticipant,
};

export function createParticipant(config: ParticipantConfig): BaseParticipant {
  if (config.type === 'generic') {
    return new GenericParticipant(config);
  }

  const Factory = BUILTIN_FACTORIES[config.id];
  if (!Factory) {
    throw new Error(
      `Unknown participant: "${config.id}". Add "type": "generic" in config for custom CLI tools.`,
    );
  }

  return new Factory(config);
}

export { BaseParticipant } from './base.js';
