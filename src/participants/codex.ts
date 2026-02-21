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
    const args = ['exec', 'resume'];

    // Use session-specific resume when available to avoid race conditions
    // with other Codex instances. Falls back to --last if no session ID.
    // Note: --session flag support is assumed but unverified — graceful fallback is in place.
    if (this.sessionId) {
      args.push('--session', this.sessionId);
    } else {
      args.push('--last');
    }

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
