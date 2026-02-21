import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export class CodexParticipant extends BaseParticipant {
  private promptFile: string | null = null;

  buildFirstCommand(prompt: string) {
    // Codex exec doesn't support stdin well — write prompt to a temp file
    // and use shell redirection to pass it
    const tmpDir = join(process.cwd(), '.multi-ai-tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    this.promptFile = join(tmpDir, `codex-prompt-${Date.now()}.txt`);
    writeFileSync(this.promptFile, prompt, 'utf-8');

    const args = [
      'exec',
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

    return {
      command: this.config.cliPath || 'codex',
      args,
      stdinData: prompt,
    };
  }

  buildContinueCommand(prompt: string) {
    const args = [
      'exec',
      'resume',
      '--last',
    ];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'codex',
      args,
      stdinData: prompt,
    };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    // Clean up temp file
    if (this.promptFile) {
      try { unlinkSync(this.promptFile); } catch { /* ignore */ }
      this.promptFile = null;
    }

    const raw = stripAnsi(result.stdout).trim();

    // Codex may output JSONL if --json was used
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
