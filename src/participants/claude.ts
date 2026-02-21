import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

// Env vars to unset so child claude process doesn't detect parent session
const CLAUDE_ENV_CLEANUP: Record<string, string | undefined> = {
  CLAUDECODE: undefined,
  CLAUDE_CODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CLAUDE_CODE_SESSION: undefined,
  CLAUDE_CODE_CONVERSATION: undefined,
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined,
};

export class ClaudeParticipant extends BaseParticipant {
  private promptFile: string | null = null;

  private writeTempPrompt(prompt: string): string {
    const tmpDir = join(process.cwd(), '.multi-ai-tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const file = join(tmpDir, `claude-prompt-${randomBytes(8).toString('hex')}.txt`);
    writeFileSync(file, prompt, 'utf-8');
    return file;
  }

  protected cleanupPromptFile() {
    if (this.promptFile) {
      try { unlinkSync(this.promptFile); } catch { /* ignore */ }
      this.promptFile = null;
    }
  }

  override cleanupCurrentPromptFile(): void {
    this.cleanupPromptFile();
  }

  buildFirstCommand(prompt: string) {
    // Clean up any previous temp file before writing a new one (prevents
    // accumulation on timeout / non-zero exit before parseOutput is reached).
    this.cleanupPromptFile();
    // Write prompt to temp file, pipe via stdin to avoid shell quoting
    // and to prevent the prompt from being intercepted by an active session
    this.promptFile = this.writeTempPrompt(prompt);

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
      env: CLAUDE_ENV_CLEANUP,
    };
  }

  buildContinueCommand(prompt: string) {
    this.cleanupPromptFile();
    this.promptFile = this.writeTempPrompt(prompt);

    const args = this.sessionId
      ? ['--resume', this.sessionId, '-p', '--output-format', 'json']
      : ['--continue', '-p', '--output-format', 'json'];

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
      env: CLAUDE_ENV_CLEANUP,
    };
  }

  isTokenLimitError(result: ProcessResult): boolean {
    // Check stderr first (base class handles all providers)
    if (super.isTokenLimitError(result)) return true;

    // Claude outputs JSON to stdout; check for is_error: true with a
    // token/context message in the result field.
    try {
      const json = JSON.parse(stripAnsi(result.stdout).trim());
      if (json.is_error && json.result) {
        return super.isTokenLimitError({ ...result, stderr: String(json.result), stdout: '' });
      }
    } catch {
      // Not JSON — skip
    }
    return false;
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    this.cleanupPromptFile();
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
