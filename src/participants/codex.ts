import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

export class CodexParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string) {
    const args = [
      'exec',
      prompt,
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--ephemeral',
    ];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return { command: this.config.cliPath || 'codex', args };
  }

  buildContinueCommand(prompt: string) {
    const args = [
      'exec',
      'resume',
      '--last',
      prompt,
    ];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return { command: this.config.cliPath || 'codex', args };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    const raw = stripAnsi(result.stdout).trim();

    // Codex exec outputs the response directly to stdout
    // Try to extract from JSONL if --json was used
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
      // Find the last message event
      for (let i = jsonLines.length - 1; i >= 0; i--) {
        const parsed = JSON.parse(jsonLines[i]);
        if (parsed.type === 'message' && parsed.content) {
          return {
            response: typeof parsed.content === 'string'
              ? parsed.content
              : JSON.stringify(parsed.content),
            sessionId: parsed.session_id,
          };
        }
      }
    }

    return { response: raw };
  }
}
