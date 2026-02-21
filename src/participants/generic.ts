import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';

/**
 * A config-driven participant that can invoke any CLI tool or script.
 * Stateless by default: each round receives a full-context prompt built by the orchestrator.
 * Opt-in session management via `config.session` (extractPattern + continueArgs, or
 * extractField-only for tools like Ollama that carry session state in their JSON response).
 */
export class GenericParticipant extends BaseParticipant {
  private sessionState: unknown = null;

  override isStateless(): boolean {
    return !this.config.session;
  }

  override displayName(): string {
    return this.config.id;
  }

  override modelDisplay(): string {
    return this.config.model || this.config.cliPath;
  }

  private buildStdinData(prompt: string, state: unknown): string | undefined {
    if (this.config.inputMode === 'arg') return undefined;
    if (this.config.stdinBody) {
      const body: Record<string, unknown> = structuredClone(this.config.stdinBody.template);
      body[this.config.stdinBody.promptField] = prompt;
      if (this.config.stdinBody.stateField && state != null) {
        body[this.config.stdinBody.stateField] = state;
      }
      return JSON.stringify(body);
    }
    return prompt;
  }

  private buildArgs(prompt: string): string[] {
    const { inputMode = 'stdin', promptArg, extraArgs = [] } = this.config;
    const args = [...extraArgs];
    if (inputMode === 'arg') {
      if (promptArg) args.push(promptArg, prompt);
      else args.push(prompt);
    }
    return args;
  }

  buildFirstCommand(prompt: string) {
    return {
      command: this.config.cliPath,
      args: this.buildArgs(prompt),
      stdinData: this.buildStdinData(prompt, null),
      env: this.config.genericEnv,
    };
  }

  buildContinueCommand(prompt: string) {
    const { session, cliPath, genericEnv } = this.config;

    if (session?.continueArgs && this.sessionId) {
      const continueArgs = session.continueArgs.map(
        (a) => a.replace('{sessionId}', this.sessionId!),
      );
      const args = [...(this.config.extraArgs ?? []), ...continueArgs];
      if (this.config.inputMode === 'arg') {
        if (this.config.promptArg) args.push(this.config.promptArg, prompt);
        else args.push(prompt);
      }
      return {
        command: cliPath,
        args,
        stdinData: this.buildStdinData(prompt, this.sessionState),
        env: genericEnv,
      };
    }

    // extractField-only session (Ollama): same args as first round, state goes in body
    return {
      command: cliPath,
      args: this.buildArgs(prompt),
      stdinData: this.buildStdinData(prompt, this.sessionState),
      env: genericEnv,
    };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    const raw = result.stdout.trim();

    // Extract session ID from stdout using extractPattern if configured
    let sessionId: string | undefined;
    if (this.config.session?.extractPattern) {
      try {
        // Check for obviously catastrophic patterns: nested quantifiers like (a+)+, (a*)*
        const pat = this.config.session.extractPattern;
        if (/\([^)]*[+*][^)]*\)[+*?]/.test(pat) || /\([^)]*\)\{[0-9,]+\}[+*]/.test(pat)) {
          process.stderr.write(`[WARN] session.extractPattern may cause ReDoS: ${pat}\n`);
        } else {
          const match = raw.match(new RegExp(pat));
          if (match?.[1]) sessionId = match[1];
        }
      } catch {
        // Invalid regex — skip silently
      }
    }

    // Parse JSON output if jsonField configured
    if (this.config.jsonField) {
      try {
        const json = JSON.parse(raw);

        // Extract complex session state (e.g. Ollama context array)
        if (this.config.session?.extractField) {
          const stateValue = json[this.config.session.extractField];
          if (stateValue !== undefined) {
            this.sessionState = stateValue;
          }
        }

        const fieldValue = json[this.config.jsonField];
        if (fieldValue !== undefined) {
          return { response: String(fieldValue), sessionId };
        }
      } catch {
        // Fall through to raw text
      }
    }

    return { response: raw, sessionId };
  }

  override resetSession(): void {
    super.resetSession();
    this.sessionState = null;
  }
}
