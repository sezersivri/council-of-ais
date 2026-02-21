import { createInterface } from 'readline';
import { join } from 'path';
import {
  DiscussionState,
  DiscussionEntry,
  MultiAiConfig,
  OrchestrationResult,
} from './types.js';
import { initializeDiscussion, appendEntry, appendFinalPlan } from './discussion.js';
import { buildInitialPrompt, buildRoundPrompt, buildFinalSummaryPrompt } from './prompt-builder.js';
import { parseResponseSections, detectConsensus } from './consensus.js';
import { runCliProcess } from './process-runner.js';
import { createParticipant, BaseParticipant } from './participants/index.js';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${seconds}s`;
  const minutes = Math.floor(ms / 60000);
  const remainingSeconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runParticipantTurn(
  participant: BaseParticipant,
  prompt: string,
  cwd: string,
  verbose: boolean,
): Promise<{ response: string; durationMs: number } | null> {
  const { command, args, stdinData, env } = participant.buildCommand(prompt);

  if (verbose) {
    log(`    Command: ${command} ${args.join(' ')}${stdinData ? ' (prompt via stdin)' : ''}`);
  }

  const result = await runCliProcess(command, args, {
    cwd,
    timeoutMs: participant.timeout,
    stdinData,
    env,
  });

  if (result.timedOut) {
    log(`  [${participant.id}] TIMED OUT after ${formatDuration(result.durationMs)}`);
    return null;
  }

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    log(`  [${participant.id}] FAILED (exit code ${result.exitCode})`);
    if (verbose && result.stderr) {
      log(`    stderr: ${result.stderr.slice(0, 500)}`);
    }
    return null;
  }

  const output = participant.parseOutput(result);

  if (!output.response) {
    log(`  [${participant.id}] Empty response, skipping`);
    return null;
  }

  if (output.sessionId) {
    participant.sessionId = output.sessionId;
  }
  participant.sessionStarted = true;

  return { response: output.response, durationMs: result.durationMs };
}

export async function orchestrate(
  topic: string,
  config: MultiAiConfig,
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  const outputPath = join(config.outputDir, config.outputFile);

  // Initialize participants
  const activeParticipants = config.participants
    .filter((p) => p.enabled)
    .map((p) => createParticipant(p));

  if (activeParticipants.length < 2) {
    throw new Error('At least 2 participants are required for a discussion');
  }

  const participantIds = activeParticipants.map((p) => p.id);

  // Initialize discussion file
  const state = initializeDiscussion(outputPath, topic, participantIds);

  log('');
  log('========================================');
  log('  Multi-AI Discussion');
  log('========================================');
  log(`  Topic: ${topic}`);
  log(`  Participants: ${activeParticipants.map((p) => p.displayName()).join(', ')}`);
  log(`  Max rounds: ${config.maxRounds}`);
  log(`  Mode: ${config.watch ? 'Interactive (--watch)' : 'Automated'}`);
  log(`  Output: ${outputPath}`);
  log('========================================');
  log('');

  let consensusReached = false;
  let userGuidance: string | undefined;

  for (let round = 1; round <= config.maxRounds; round++) {
    log(`--- Round ${round} of ${config.maxRounds} ---`);
    log('');

    for (const participant of activeParticipants) {
      log(`  [${participant.id}] Thinking...`);

      // Build prompt: initial for Round 1, delta for Round 2+
      let prompt: string;
      if (round === 1) {
        prompt = buildInitialPrompt(topic, participant.id, round, config.maxRounds);
      } else {
        prompt = buildRoundPrompt(state, participant.id, round, config.maxRounds, userGuidance);
      }

      const result = await runParticipantTurn(participant, prompt, process.cwd(), config.verbose);

      if (!result) continue;

      // Parse structured sections
      const parsed = parseResponseSections(result.response);
      const signal = parsed?.consensusSignal || 'UNKNOWN';

      const entry: DiscussionEntry = {
        round,
        participant: participant.id,
        timestamp: new Date().toISOString(),
        rawResponse: result.response,
        parsedSections: parsed,
      };

      appendEntry(outputPath, state, entry);

      log(`  [${participant.id}] Done (${formatDuration(result.durationMs)}) — Signal: ${signal}`);
    }

    // Clear user guidance after it's been used
    userGuidance = undefined;

    // Check consensus
    state.consensusStatus = detectConsensus(state, config.consensusThreshold);
    log('');
    log(`  Consensus status: ${state.consensusStatus}`);

    if (state.consensusStatus === 'full') {
      log('');
      log('  *** CONSENSUS REACHED ***');
      consensusReached = true;
      break;
    }

    // Watch mode: pause between rounds
    if (config.watch && round < config.maxRounds) {
      log('');
      const input = await promptUser(
        '  [Enter] continue | [s] stop | or type guidance for next round: ',
      );

      if (input.toLowerCase() === 's') {
        log('  Stopping discussion by user request.');
        break;
      } else if (input.length > 0) {
        userGuidance = input;
        log(`  Guidance noted: "${input}"`);
      }
      log('');
    }
  }

  // Generate final summary
  log('');
  log('Generating final summary...');

  const summarizer = activeParticipants[0];
  const summaryPrompt = buildFinalSummaryPrompt(state);

  const summaryResult = await runParticipantTurn(
    summarizer,
    summaryPrompt,
    process.cwd(),
    config.verbose,
  );

  if (summaryResult) {
    appendFinalPlan(outputPath, state, summaryResult.response, consensusReached);
  } else {
    appendFinalPlan(
      outputPath,
      state,
      '*Failed to generate final summary. See discussion above.*',
      consensusReached,
    );
  }

  const totalMs = Date.now() - startTime;
  const maxRound = state.entries.length > 0
    ? Math.max(...state.entries.map((e) => e.round))
    : 0;

  log('');
  log('========================================');
  log('  Discussion Complete');
  log('========================================');
  log(`  Rounds: ${maxRound}`);
  log(`  Consensus: ${consensusReached ? 'YES' : 'NO'}`);
  log(`  Duration: ${formatDuration(totalMs)}`);
  log(`  Output: ${outputPath}`);
  log('========================================');
  log('');

  return {
    topic,
    totalRounds: maxRound,
    consensusReached,
    finalPlan: state.finalPlan,
    discussionFilePath: outputPath,
    participants: participantIds,
    durationMs: totalMs,
  };
}
