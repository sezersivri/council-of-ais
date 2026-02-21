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
    // Use session-specific resume when available to avoid race conditions
    // with other Gemini instances. Falls back to 'latest' if no session ID.
    // Note: session-specific --resume support is assumed but unverified — graceful fallback is in place.
    const args = ['--resume', this.sessionId || 'latest'];

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
