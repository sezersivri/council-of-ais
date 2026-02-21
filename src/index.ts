#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runDiscussion } from './orchestrator.js';
import { replay } from './replay.js';
import { ParticipantId } from './types.js';

const program = new Command();

program
  .name('multi-ai')
  .description('Orchestrate multiple AI CLIs for structured discussion and consensus')
  .version('0.1.0')
  .argument('[topic]', 'The topic or question for the AIs to discuss')
  .option('--topic-file <path>', 'Read discussion topic from a markdown or text file')
  .option('-r, --rounds <number>', 'Maximum number of discussion rounds', '5')
  .option(
    '-p, --participants <list>',
    'Comma-separated list of participants (claude,codex,gemini)',
    'claude,codex,gemini',
  )
  .option('-o, --output <file>', 'Output file name', 'discussion.md')
  .option('-c, --config <path>', 'Path to config file')
  .option('-w, --watch', 'Interactive mode: pause between rounds for user input', false)
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('--validate-artifacts', 'Validate code artifacts in AI responses', false)
  .option('--stream', 'Show live streaming progress for each participant', false)
  .option('--dry-run', 'Print Round 1 prompts and exit without invoking CLIs', false)
  .option('--replay <path>', 'Replay a saved discussion from a state JSON file')
  .option('--debug', 'Emit structured state-transition debug logs to stderr', false)
  .option('--json-report <path>', 'Write a structured JSON report to the given file path')
  .option(
    '--ci',
    'CI mode: write JSON report to ./result.json, skip preflight prompts, enforce exit codes',
    false,
  )
  .action(async (topicArg: string | undefined, options) => {
    try {
      // Replay mode: print a saved discussion transcript
      if (options.replay) {
        replay(options.replay);
        return;
      }

      // Resolve topic from argument or --topic-file
      let topic: string | undefined = topicArg;

      if (options.topicFile) {
        if (!existsSync(options.topicFile)) {
          console.error(`Error: Topic file not found: ${options.topicFile}`);
          process.exit(2);
        }
        topic = readFileSync(options.topicFile, 'utf-8').trim();
      }

      if (!topic) {
        console.error('Error: Provide a topic argument or --topic-file <path>');
        process.exit(2);
      }

      const participantIds = (options.participants as string)
        .split(',')
        .map((p: string) => p.trim().toLowerCase() as ParticipantId)
        .filter((p: ParticipantId) => ['claude', 'codex', 'gemini'].includes(p));

      if (participantIds.length < 2) {
        console.error('Error: At least 2 participants are required.');
        console.error('Available: claude, codex, gemini');
        process.exit(2);
      }

      const config = loadConfig(options.config, {
        maxRounds: parseInt(options.rounds, 10),
        participants: participantIds,
        outputFile: options.output,
        verbose: options.verbose,
        watch: options.watch,
        validateArtifacts: options.validateArtifacts,
        stream: options.stream,
        dryRun: options.dryRun,
        debug: options.debug,
        jsonReport: options.jsonReport,
        ci: options.ci,
      });

      const result = await runDiscussion(topic, config);

      // Exit code logic:
      //   0 = full consensus + quality gate pass
      //   1 = no consensus, partial, or quality gate warn/fail
      //   2 = infrastructure error (handled by catch block)
      if (result.consensusReached && result.qualityGate === 'pass') {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Infrastructure errors (preflight, missing CLIs) → exit code 2
      if (
        msg.includes('Preflight failed') ||
        msg.includes('not found') ||
        msg.includes('At least 2 participants')
      ) {
        console.error('Infrastructure error:', msg);
        process.exit(2);
      }

      console.error('Fatal error:', msg);
      process.exit(1);
    }
  });

program.parse();
