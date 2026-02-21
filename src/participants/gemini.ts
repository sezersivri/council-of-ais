import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

export class GeminiParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string) {
    // Gemini reads from stdin in headless mode
    const args: string[] = [];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'gemini',
      args,
      stdinData: prompt,
    };
  }

  buildContinueCommand(prompt: string) {
    const args = ['--resume', 'latest'];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'gemini',
      args,
      stdinData: prompt,
    };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    const raw = stripAnsi(result.stdout).trim();

    // Gemini with --output-format stream-json outputs JSON lines
    const lines = raw.split('\n');
    const jsonLines = lines.filter((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });

    if (jsonLines.length > 0) {
      const textParts: string[] = [];
      for (const line of jsonLines) {
        const parsed = JSON.parse(line);
        if (parsed.text) {
          textParts.push(parsed.text);
        } else if (parsed.result) {
          return { response: parsed.result };
        }
      }
      if (textParts.length > 0) {
        return { response: textParts.join('') };
      }
    }

    return { response: raw };
  }
}
