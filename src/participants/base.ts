import { ParticipantConfig, ParticipantId, ProcessResult, ParticipantOutput } from '../types.js';

export interface CommandSpec {
  command: string;
  args: string[];
  stdinData?: string;
  env?: Record<string, string | undefined>;
}

export abstract class BaseParticipant {
  public sessionStarted = false;
  public sessionId?: string;

  constructor(public readonly config: ParticipantConfig) {}

  get id(): ParticipantId {
    return this.config.id;
  }

  get timeout(): number {
    return this.config.timeoutMs;
  }

  abstract buildFirstCommand(prompt: string): CommandSpec;
  abstract buildContinueCommand(prompt: string): CommandSpec;
  abstract parseOutput(result: ProcessResult): ParticipantOutput;

  buildCommand(prompt: string): CommandSpec {
    if (this.sessionStarted) {
      return this.buildContinueCommand(prompt);
    }
    return this.buildFirstCommand(prompt);
  }

  displayName(): string {
    const names: Record<ParticipantId, string> = {
      claude: 'Claude (Anthropic)',
      codex: 'Codex (OpenAI)',
      gemini: 'Gemini (Google)',
    };
    return names[this.config.id];
  }
}
