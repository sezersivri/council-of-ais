import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

const MAX_ARG_LENGTH = 30000;

export class ClaudeParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string) {
    const args = ['--print', '--output-format', 'json'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    if (prompt.length > MAX_ARG_LENGTH) {
      args.push('--print');
      return {
        command: this.config.cliPath || 'claude',
        args,
        stdinData: prompt,
      };
    }

    args.push('-p', prompt);
    return { command: this.config.cliPath || 'claude', args };
  }

  buildContinueCommand(prompt: string) {
    const args = ['--continue', '--print', '--output-format', 'json'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    if (prompt.length > MAX_ARG_LENGTH) {
      return {
        command: this.config.cliPath || 'claude',
        args,
        stdinData: prompt,
      };
    }

    args.push('-p', prompt);
    return { command: this.config.cliPath || 'claude', args };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    const raw = stripAnsi(result.stdout).trim();

    // Try to parse as JSON (--output-format json)
    try {
      const json = JSON.parse(raw);
      return {
        response: json.result || json.content || raw,
        sessionId: json.session_id,
      };
    } catch {
      // If JSON parsing fails, return raw stdout
      return { response: raw };
    }
  }
}
