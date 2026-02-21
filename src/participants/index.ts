import { ParticipantConfig, ParticipantId } from '../types.js';
import { BaseParticipant } from './base.js';
import { ClaudeParticipant } from './claude.js';
import { CodexParticipant } from './codex.js';
import { GeminiParticipant } from './gemini.js';

export function createParticipant(config: ParticipantConfig): BaseParticipant {
  const factories: Record<ParticipantId, new (config: ParticipantConfig) => BaseParticipant> = {
    claude: ClaudeParticipant,
    codex: CodexParticipant,
    gemini: GeminiParticipant,
  };

  const Factory = factories[config.id];
  if (!Factory) {
    throw new Error(`Unknown participant: ${config.id}`);
  }

  return new Factory(config);
}

export { BaseParticipant } from './base.js';
