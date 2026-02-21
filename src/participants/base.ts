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
  public lastFailureWasTokenLimit = false;

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

  modelDisplay(): string {
    return this.config.model || 'default';
  }

  resetSession(): void {
    this.sessionStarted = false;
    this.sessionId = undefined;
    this.lastFailureWasTokenLimit = false;
  }

  isTokenLimitError(result: ProcessResult): boolean {
    const text = `${result.stderr} ${result.stdout}`.toLowerCase();
    const patterns = [
      'context_length_exceeded',
      'context length',
      'context window',
      'token limit',
      'max_tokens_exceeded',
      'maximum context',
      'too many tokens',
      'input too long',
      'prompt is too long',
      'resource_exhausted',
      'content too large',
      'request too large',
      'exceeds the model',
    ];
    return patterns.some((p) => text.includes(p));
  }
}
