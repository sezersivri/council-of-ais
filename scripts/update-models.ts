/**
 * Auto-detect the best available model for each participant CLI and
 * update config.default.json and config.self-review.json in place.
 *
 * Run from a clean terminal (outside Claude Code):
 *   npm run update-models
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectBestModel, MODEL_PRIORITY } from '../src/model-detector.js';
import type { ParticipantId, ParticipantConfig } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CONFIG_FILES = [
  join(ROOT, 'config.default.json'),
  join(ROOT, 'config.self-review.json'),
];

function ok(msg: string)   { process.stdout.write(`  \x1b[32m✔\x1b[0m  ${msg}\n`); }
function fail(msg: string) { process.stdout.write(`  \x1b[31m✘\x1b[0m  ${msg}\n`); }
function info(msg: string) { process.stdout.write(`  \x1b[90m${msg}\x1b[0m\n`); }
function head(msg: string) { process.stdout.write(`\n${msg}\n`); }

async function main() {
  head('Detecting best available models...');
  info(`Priority order per provider:`);
  for (const [id, models] of Object.entries(MODEL_PRIORITY)) {
    info(`  ${id.padEnd(7)}: ${models.join(' → ')}`);
  }
  process.stdout.write('\n');

  // Collect participant configs from default config (as the source of cliPaths)
  const defaultRaw = JSON.parse(readFileSync(join(ROOT, 'config.default.json'), 'utf-8'));
  const participants: ParticipantConfig[] = defaultRaw.participants;

  const detected: Partial<Record<ParticipantId, string>> = {};

  for (const cfg of participants) {
    if (!cfg.enabled) { info(`${cfg.id}: skipped (disabled)`); continue; }

    const priority = MODEL_PRIORITY[cfg.id];
    process.stdout.write(`  Probing ${cfg.id} (${priority.length} models)...\n`);

    const best = await detectBestModel(cfg.id, cfg.cliPath || cfg.id);

    if (best) {
      ok(`${cfg.id}: ${best}`);
      detected[cfg.id] = best;
    } else {
      fail(`${cfg.id}: no working model found`);
    }
  }

  if (Object.keys(detected).length === 0) {
    process.stdout.write('\nNo models detected. Configs unchanged.\n\n');
    process.exit(1);
  }

  // Apply detected models to each config file
  head('Updating config files...');

  for (const configPath of CONFIG_FILES) {
    if (!existsSync(configPath)) continue;

    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    let changed = false;

    for (const p of raw.participants as ParticipantConfig[]) {
      const best = detected[p.id];
      if (!best) continue;

      if (p.model !== best) {
        info(`  ${configPath.split('/').pop()}: ${p.id} ${p.model || '(none)'} → ${best}`);
        p.model = best;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
      ok(`Saved ${configPath.split('\\').pop() ?? configPath}`);
    } else {
      info(`  ${configPath.split('\\').pop() ?? configPath}: no changes`);
    }
  }

  process.stdout.write('\nDone. Run npm run test-clis to verify.\n\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
