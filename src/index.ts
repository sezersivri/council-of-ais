#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { orchestrate } from './orchestrator.js';
import { ParticipantId } from './types.js';

const program = new Command();

program
  .name('multi-ai')
  .description('Orchestrate multiple AI CLIs for structured discussion and consensus')
  .version('0.1.0')
  .argument('<topic>', 'The topic or question for the AIs to discuss')
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
  .action(async (topic: string, options) => {
    try {
      const participantIds = (options.participants as string)
        .split(',')
        .map((p: string) => p.trim().toLowerCase() as ParticipantId)
        .filter((p: ParticipantId) => ['claude', 'codex', 'gemini'].includes(p));

      if (participantIds.length < 2) {
        console.error('Error: At least 2 participants are required.');
        console.error('Available: claude, codex, gemini');
        process.exit(1);
      }

      const config = loadConfig(options.config, {
        maxRounds: parseInt(options.rounds, 10),
        participants: participantIds,
        outputFile: options.output,
        verbose: options.verbose,
        watch: options.watch,
        validateArtifacts: options.validateArtifacts,
        stream: options.stream,
      });

      await orchestrate(topic, config);
    } catch (err) {
      console.error(
        'Fatal error:',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
  });

program.parse();
