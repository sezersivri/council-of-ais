import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export class CodexParticipant extends BaseParticipant {
  private promptFile: string | null = null;

  private cleanupPromptFile() {
    if (this.promptFile) {
      try { unlinkSync(this.promptFile); } catch { /* ignore */ }
      this.promptFile = null;
    }
  }

  override cleanupCurrentPromptFile(): void {
    this.cleanupPromptFile();
  }

  buildFirstCommand(prompt: string) {
    // Clean up any previous temp file before writing a new one.
    this.cleanupPromptFile();
    // Codex exec doesn't support stdin well — write prompt to a temp file
    // and use shell redirection to pass it
    const tmpDir = join(process.cwd(), '.multi-ai-tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    this.promptFile = join(tmpDir, `codex-prompt-${randomBytes(8).toString('hex')}.txt`);
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
    // If no session ID was captured (e.g. first round failed before parsing),
    // start a fresh ephemeral session instead of using --last which could
    // accidentally resume another Codex session from parallel execution.
    if (!this.sessionId) {
      return this.buildFirstCommand(prompt);
    }

    const args = ['exec', 'resume', '--session', this.sessionId];

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

  isTokenLimitError(result: ProcessResult): boolean {
    // Codex echoes the full conversation (including the user prompt) in stderr
    // as a session log. The prompt may legitimately contain phrases like
    // "token limit" or "context window" (e.g. when the topic discusses those
    // concepts). Strip everything from the conversation echo onward so we only
    // check the Codex header/error section at the top of stderr.
    //
    // Stderr structure:
    //   Reading prompt from stdin...
    //   OpenAI Codex v0.x.y
    //   --------
    //   workdir: ...  model: ...  session id: ...
    //   --------         ← second separator
    //   user             ← conversation echo starts here
    //   [prompt text]
    const stderr = stripAnsi(result.stderr);
    const firstSep = stderr.indexOf('--------');
    const secondSep = firstSep !== -1 ? stderr.indexOf('--------', firstSep + 8) : -1;
    const headerOnly = secondSep !== -1 ? stderr.slice(0, secondSep) : stderr;
    return super.isTokenLimitError({ ...result, stderr: headerOnly });
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    // Clean up temp file
    if (this.promptFile) {
      try { unlinkSync(this.promptFile); } catch { /* ignore */ }
      this.promptFile = null;
    }

    const raw = stripAnsi(result.stdout).trim();

    // Codex may output JSONL if --json was used.
    // Validate JSON shape: Codex JSONL always has a `type` field.
    // Lines that parse as JSON but lack `type` are treated as plain text
    // (e.g. example API payloads the LLM included in its response).
    const lines = raw.split('\n');
    const textLines: string[] = [];
    const metadataLines: Array<Record<string, unknown>> = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
          metadataLines.push(parsed as Record<string, unknown>);
        } else {
          textLines.push(line);
        }
      } catch {
        textLines.push(line);
      }
    }

    if (metadataLines.length > 0) {
      for (let i = metadataLines.length - 1; i >= 0; i--) {
        const parsed = metadataLines[i];
        if (parsed.type === 'message' && parsed.content) {
          return {
            response: typeof parsed.content === 'string'
              ? (parsed.content as string)
              : JSON.stringify(parsed.content),
            sessionId: parsed.session_id as string | undefined,
          };
        }
      }
    }

    // Fall back to non-metadata text lines, or raw output
    const textOutput = textLines.join('\n').trim();
    return { response: textOutput || raw };
  }
}
