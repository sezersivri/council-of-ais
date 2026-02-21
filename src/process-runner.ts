import { spawn } from 'child_process';
import { ProcessResult } from './types.js';

export async function runCliProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    stdinData?: string;
    env?: Record<string, string | undefined>;
    onStdoutData?: (chunk: string) => void;
  },
): Promise<ProcessResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Build env: spread process.env, then apply overrides.
    // Keys set to undefined are deleted (unset from child process).
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }

    // On Windows, npm global shims are .cmd files that require a shell to execute.
    // On Unix, we skip the shell to avoid command injection and quoting bugs.
    const proc = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const MAX_BYTES = 5 * 1024 * 1024;
    const TRUNC_MARKER = '\n[OUTPUT TRUNCATED — exceeded 5MB]\n';

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      options.onStdoutData?.(chunk);
      if (stdout.length < MAX_BYTES) {
        stdout += chunk;
        if (stdout.length >= MAX_BYTES) stdout += TRUNC_MARKER;
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_BYTES) {
        stderr += data.toString();
        if (stderr.length >= MAX_BYTES) stderr += TRUNC_MARKER;
      }
    });

    if (options.stdinData) {
      proc.stdin.write(options.stdinData);
      proc.stdin.end();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 5000);
    }, options.timeoutMs);

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: -1,
        timedOut: false,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
