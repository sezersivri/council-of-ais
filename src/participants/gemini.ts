import { BaseParticipant } from './base.js';
import { ProcessResult, ParticipantOutput } from '../types.js';
import { stripAnsi } from '../process-runner.js';

export class GeminiParticipant extends BaseParticipant {
  buildFirstCommand(prompt: string) {
    // Gemini reads from stdin in headless mode.
    // Model is set via GEMINI_MODEL env var rather than -m flag because
    // the -m flag does not support preview/experimental model names.
    const args: string[] = [];
    const env: Record<string, string | undefined> = {};

    if (this.config.model) {
      env['GEMINI_MODEL'] = this.config.model;
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'gemini',
      args,
      stdinData: prompt,
      env,
    };
  }

  buildContinueCommand(prompt: string) {
    const args = ['--resume', this.sessionId || 'latest'];
    const env: Record<string, string | undefined> = {};

    if (this.config.model) {
      env['GEMINI_MODEL'] = this.config.model;
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    return {
      command: this.config.cliPath || 'gemini',
      args,
      stdinData: prompt,
      env,
    };
  }

  parseOutput(result: ProcessResult): ParticipantOutput {
    const raw = stripAnsi(result.stdout).trim();

    // Gemini with --output-format stream-json outputs JSON lines.
    // Validate JSON shape: only treat as CLI metadata if the object has at least
    // one known Gemini field. Lines that parse as JSON but lack known fields are
    // treated as plain text (e.g. example API payloads the LLM included in its response).
    const KNOWN_FIELDS = ['text', 'result', 'session_id', 'type', 'status'];
    const lines = raw.split('\n');
    const textParts: string[] = [];
    const textLines: string[] = [];
    let sessionId: string | undefined;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' &&
            Object.keys(parsed).some((k) => KNOWN_FIELDS.includes(k))) {
          if (parsed.session_id) {
            sessionId = parsed.session_id;
          }
          if (parsed.text) {
            textParts.push(parsed.text);
          } else if (parsed.result) {
            return { response: parsed.result, sessionId };
          }
        } else {
          textLines.push(line);
        }
      } catch {
        textLines.push(line);
      }
    }

    if (textParts.length > 0) {
      return { response: textParts.join(''), sessionId };
    }

    // Fall back to non-metadata text lines, or raw output
    const textOutput = textLines.join('\n').trim();
    return { response: textOutput || raw, sessionId };
  }
}
