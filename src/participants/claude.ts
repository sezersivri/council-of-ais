import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

export class ClaudeParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string) {
    // Always pipe prompt via stdin to avoid shell quoting issues
    const args = ['-p', '--output-format', 'json'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'claude',
      args,
      stdinData: prompt,
      env: { CLAUDECODE: '' }, // Allow nesting inside Claude Code session
    };
  }

  buildContinueCommand(prompt: string) {
    const args = ['--continue', '-p', '--output-format', 'json'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'claude',
      args,
      stdinData: prompt,
      env: { CLAUDECODE: '' },
    };
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
