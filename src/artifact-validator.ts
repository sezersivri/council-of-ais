import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { runCliProcess } from './process-runner.js';

const TMP_DIR = join(process.cwd(), '.multi-ai-tmp');

export async function validateArtifact(
  code: string,
  language: string,
  participantId: string,
): Promise<string | null> {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  const isTs = ['typescript', 'ts', 'tsx'].includes(language);
  const isJs = ['javascript', 'js', 'jsx'].includes(language);

  if (!isTs && !isJs) return null; // Only validate JS/TS

  const ext = isTs ? '.ts' : '.js';
  const filePath = join(TMP_DIR, `artifact-${participantId}-${Date.now()}${ext}`);
  writeFileSync(filePath, code, 'utf-8');

  try {
    if (isTs) {
      const result = await runCliProcess('npx', [
        'tsc', '--noEmit', '--noResolve', '--strict',
        '--target', 'ES2022', '--module', 'esnext',
        filePath,
      ], {
        cwd: process.cwd(),
        timeoutMs: 15000,
      });
      if (result.exitCode !== 0) {
        const errors = (result.stdout + '\n' + result.stderr).trim();
        return errors || 'TypeScript compilation failed';
      }
    } else {
      const result = await runCliProcess('node', ['--check', filePath], {
        cwd: process.cwd(),
        timeoutMs: 10000,
      });
      if (result.exitCode !== 0) {
        return (result.stderr || 'JavaScript syntax check failed').trim();
      }
    }
    return null; // No errors
  } finally {
    try { unlinkSync(filePath); } catch { /* ignore */ }
  }
}
