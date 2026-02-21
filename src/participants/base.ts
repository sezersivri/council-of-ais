import { ParticipantConfig, ParticipantId, ProcessResult, ParticipantOutput } from '../types.js';

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

  abstract buildFirstCommand(prompt: string): { command: string; args: string[]; stdinData?: string };
  abstract buildContinueCommand(prompt: string): { command: string; args: string[]; stdinData?: string };
  abstract parseOutput(result: ProcessResult): ParticipantOutput;

  buildCommand(prompt: string): { command: string; args: string[]; stdinData?: string } {
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
