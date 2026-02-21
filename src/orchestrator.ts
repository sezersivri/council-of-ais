import { createInterface } from 'readline';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import {
  DiscussionState,
  DiscussionEntry,
  MultiAiConfig,
  OrchestrationResult,
  ParticipantId,
} from './types.js';
import { initializeDiscussion, appendEntry, appendFinalPlan, saveStateJson } from './discussion.js';
import {
  buildInitialPrompt, buildRoundPrompt, buildFinalSummaryPrompt,
  buildTieBreakerLeadPrompt, buildTieBreakerFollowPrompt,
} from './prompt-builder.js';
import { parseResponseSections, extractCodeArtifact, detectConsensus } from './consensus.js';
import { runCliProcess } from './process-runner.js';
import { createParticipant, BaseParticipant } from './participants/index.js';
import { validateArtifact } from './artifact-validator.js';
import { StreamDisplay } from './stream-display.js';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

async function runPreflightChecks(
  participants: BaseParticipant[],
): Promise<void> {
  log('Preflight checks...');

  const results = await Promise.allSettled(
    participants.map(async (p) => {
      const cliPath = p.config.cliPath || p.id;
      const result = await runCliProcess(cliPath, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 5000,
      });
      return { participant: p, result, cliPath };
    }),
  );

  const failures: string[] = [];

  for (const settled of results) {
    if (settled.status === 'rejected') {
      failures.push(`  Unknown error: ${settled.reason}`);
      continue;
    }

    const { participant, result, cliPath } = settled.value;
    if (result.exitCode === 0 || result.stdout.trim()) {
      const version = result.stdout.trim().split('\n')[0].slice(0, 60);
      log(`  [${participant.id}] OK — ${version} (model: ${participant.modelDisplay()})`);
    } else {
      log(`  [${participant.id}] FAILED`);
      failures.push(
        `  ${participant.id}: '${cliPath}' not found or not authenticated.\n` +
        `    Install: see README or run '${cliPath} --help'`,
      );
    }
  }

  if (failures.length > 0) {
    log('');
    throw new Error(
      `Preflight failed for ${failures.length} participant(s):\n${failures.join('\n')}`,
    );
  }

  log('');
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runParticipantTurn(
  participant: BaseParticipant,
  prompt: string,
  cwd: string,
  verbose: boolean,
  onStdoutData?: (chunk: string) => void,
): Promise<{ response: string; durationMs: number } | null> {
  participant.lastFailureWasTokenLimit = false;
  const { command, args, stdinData, env } = participant.buildCommand(prompt);

  if (verbose) {
    log(`    Command: ${command} ${args.join(' ')}${stdinData ? ' (prompt via stdin)' : ''}`);
  }

  const result = await runCliProcess(command, args, {
    cwd,
    timeoutMs: participant.timeout,
    stdinData,
    env,
    onStdoutData,
  });

  if (result.timedOut) {
    log(`  [${participant.id}] TIMED OUT after ${formatDuration(result.durationMs)}`);
    return null;
  }

  // Check for token/context limit before generic failure handling
  if (participant.isTokenLimitError(result)) {
    participant.lastFailureWasTokenLimit = true;
    log(`  [${participant.id}] TOKEN LIMIT reached (${formatDuration(result.durationMs)})`);
    if (verbose && result.stderr) {
      log(`    stderr: ${result.stderr.slice(0, 500)}`);
    }
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

async function runParticipantTurnWithRetry(
  participant: BaseParticipant,
  prompt: string,
  cwd: string,
  verbose: boolean,
  onStdoutData?: (chunk: string) => void,
): Promise<{ response: string; durationMs: number } | null> {
  const maxRetries = participant.config.maxRetries ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = 2000 * attempt; // 2s, 4s, ...
      log(`  [${participant.id}] Retrying (attempt ${attempt + 1}/${maxRetries + 1}) after ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }

    const result = await runParticipantTurn(participant, prompt, cwd, verbose, onStdoutData);
    if (result) return result;

    // Don't retry token limit errors — retrying won't help
    if (participant.lastFailureWasTokenLimit) return null;
  }

  return null;
}

interface RoundEntryResult {
  entry: DiscussionEntry;
  durationMs: number;
}

function printRoundSummary(results: RoundEntryResult[], failedIds: Set<ParticipantId>, tokenLimitIds: Set<ParticipantId>) {
  log('');
  log('  ┌───────────┬──────────────────┬─────────┐');
  for (const { entry, durationMs } of results) {
    const signal = entry.parsedSections?.consensusSignal || 'UNKNOWN';
    const name = entry.participant.padEnd(9);
    const signalStr = signal.padEnd(16);
    const duration = formatDuration(durationMs).padStart(7);
    log(`  │ ${name} │ ${signalStr} │ ${duration} │`);
  }
  for (const pid of failedIds) {
    const name = pid.padEnd(9);
    if (tokenLimitIds.has(pid)) {
      log(`  │ ${name} │ TOKEN LIMIT      │         │`);
    } else {
      log(`  │ ${name} │ (failed)         │         │`);
    }
  }
  log('  └───────────┴──────────────────┴─────────┘');
}

function cleanupTempDir() {
  const tmpDir = join(process.cwd(), '.multi-ai-tmp');
  if (existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export async function orchestrate(
  topic: string,
  config: MultiAiConfig,
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  const outputPath = join(config.outputDir, config.outputFile);
  const stateJsonPath = join(config.outputDir, 'discussion-state.json');

  // Initialize participants
  const activeParticipants = config.participants
    .filter((p) => p.enabled)
    .map((p) => createParticipant(p));

  if (activeParticipants.length < 2) {
    throw new Error('At least 2 participants are required for a discussion');
  }

  // Pre-flight: verify all CLIs are available before starting
  await runPreflightChecks(activeParticipants);

  const participantIds = activeParticipants.map((p) => p.id);

  // Initialize discussion file
  const state = initializeDiscussion(outputPath, topic, participantIds);

  // Track failed participants across rounds
  const failedParticipants = new Set<ParticipantId>();

  // Track participants that hit token limit last round (they rejoin with fresh session)
  const tokenLimitedLastRound = new Set<ParticipantId>();

  // Build session map for state persistence
  const sessionMap = new Map<ParticipantId, string | undefined>();
  for (const p of activeParticipants) {
    sessionMap.set(p.id, undefined);
  }

  // SIGINT handler: flush state and clean up
  let sigintReceived = false;
  const sigintHandler = () => {
    if (sigintReceived) {
      // Second Ctrl+C: force exit
      process.exit(1);
    }
    sigintReceived = true;
    log('\n  Interrupted — flushing state...');
    try {
      saveStateJson(stateJsonPath, state, sessionMap);
      log(`  State saved to ${stateJsonPath}`);
    } catch {
      // best-effort
    }
    cleanupTempDir();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  // Temp dir cleanup on normal exit
  process.on('exit', () => {
    cleanupTempDir();
  });

  log('');
  log('========================================');
  log('  Multi-AI Discussion');
  log('========================================');
  log(`  Topic: ${topic}`);
  log('  Participants:');
  for (const p of activeParticipants) {
    log(`    ${p.displayName().padEnd(20)} — ${p.modelDisplay()}`);
  }
  log(`  Max rounds: ${config.maxRounds}`);
  log(`  Mode: ${config.watch ? 'Interactive (--watch)' : 'Automated'}`);
  if (config.validateArtifacts) log('  Artifact validation: ON');
  if (config.stream) log('  Streaming display: ON');
  log(`  Output: ${outputPath}`);
  log('========================================');
  log('');

  // Tie-breaker state
  const leadParticipant = activeParticipants.find((p) => p.config.lead);
  let tieBreakerPhase: 'inactive' | 'lead-proposes' | 'others-respond' = 'inactive';

  if (leadParticipant) {
    log(`  Lead Architect: ${leadParticipant.displayName()}`);
    log('');
  }

  let consensusReached = false;
  let userGuidance: string | undefined;

  for (let round = 1; round <= config.maxRounds; round++) {
    log(`--- Round ${round} of ${config.maxRounds} ---`);
    log('');

    // Filter out permanently failed participants
    const roundParticipants = activeParticipants.filter(
      (p) => !failedParticipants.has(p.id),
    );

    if (roundParticipants.length < 2) {
      log('  Too few participants remaining, ending discussion.');
      break;
    }

    // Build prompts for each participant
    const participantPrompts = new Map<BaseParticipant, string>();
    for (const participant of roundParticipants) {
      let prompt: string;

      if (round === 1) {
        prompt = buildInitialPrompt(
          topic,
          participant.id,
          round,
          config.maxRounds,
          participant.config.role,
        );
      } else if (tieBreakerPhase === 'lead-proposes' && leadParticipant && participant.id === leadParticipant.id) {
        prompt = buildTieBreakerLeadPrompt(state, participant.id, round, config.maxRounds, userGuidance);
      } else if (tieBreakerPhase === 'others-respond' && leadParticipant && participant.id !== leadParticipant.id) {
        prompt = buildTieBreakerFollowPrompt(state, participant.id, leadParticipant.id, round, config.maxRounds, userGuidance);
      } else {
        prompt = buildRoundPrompt(state, participant.id, round, config.maxRounds, userGuidance);
      }

      // Inject failed participant info into delta prompts for round 2+
      if (round > 1 && failedParticipants.size > 0) {
        const failedList = Array.from(failedParticipants).join(', ');
        prompt += `\n\n**Note:** The following participants have dropped out due to failures: ${failedList}. Continue the discussion with remaining participants.`;
      }

      // Notify about participants rejoining after token limit
      if (tokenLimitedLastRound.size > 0) {
        const limitList = Array.from(tokenLimitedLastRound).join(', ');
        prompt += `\n\n**Note:** ${limitList} hit their token limit last round and are rejoining with a fresh session. Brief context may help them catch up.`;
      }

      participantPrompts.set(participant, prompt);
    }

    // Streaming display or simple log
    const useStreaming = config.stream && process.stdout.isTTY;
    let streamDisplay: StreamDisplay | undefined;

    if (useStreaming) {
      streamDisplay = new StreamDisplay(roundParticipants.map((p) => p.id));
      streamDisplay.start();
    } else {
      for (const participant of roundParticipants) {
        log(`  [${participant.id}] Thinking...`);
      }
    }

    // Run all participants in parallel
    const results = await Promise.allSettled(
      roundParticipants.map(async (participant) => {
        const prompt = participantPrompts.get(participant)!;
        const onData = streamDisplay
          ? (chunk: string) => streamDisplay!.onData(participant.id, chunk)
          : undefined;
        const result = await runParticipantTurnWithRetry(
          participant,
          prompt,
          process.cwd(),
          config.verbose,
          onData,
        );
        if (streamDisplay) {
          if (result) {
            streamDisplay.onDone(participant.id);
          } else {
            streamDisplay.onFailed(participant.id);
          }
        }
        return { participant, result };
      }),
    );

    streamDisplay?.stop();

    // Process results
    const roundResults: RoundEntryResult[] = [];
    const roundFailedIds = new Set<ParticipantId>();
    const roundTokenLimitIds = new Set<ParticipantId>();
    const artifactErrors: string[] = [];

    for (const settled of results) {
      if (settled.status === 'rejected') {
        // Promise itself was rejected (unexpected)
        log(`  [unknown] Unexpected error: ${settled.reason}`);
        continue;
      }

      const { participant, result } = settled.value;

      if (!result) {
        roundFailedIds.add(participant.id);

        if (participant.lastFailureWasTokenLimit) {
          // Token limit: reset session so they rejoin next round fresh
          roundTokenLimitIds.add(participant.id);
          participant.resetSession();
          log('');
          log(`  WARNING: [${participant.id}] hit token/context limit — session reset, will rejoin next round`);
        } else {
          // Permanent failure
          if (!useStreaming) log(`  [${participant.id}] Failed all retries`);
          failedParticipants.add(participant.id);
        }
        continue;
      }

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
      roundResults.push({ entry, durationMs: result.durationMs });

      if (!useStreaming) {
        log(`  [${participant.id}] Done (${formatDuration(result.durationMs)}) — Signal: ${signal}`);
      }

      // Artifact validation (opt-in via --validate-artifacts)
      if (config.validateArtifacts) {
        const artifact = extractCodeArtifact(result.response);
        if (artifact) {
          log(`  [${participant.id}] Validating code artifact (${artifact.language})...`);
          try {
            const error = await validateArtifact(artifact.code, artifact.language, participant.id);
            if (error) {
              log(`  [${participant.id}] Artifact FAILED validation`);
              artifactErrors.push(`[${participant.id}] Artifact validation failed:\n${error}`);
            } else {
              log(`  [${participant.id}] Artifact passed validation`);
            }
          } catch {
            // Validation tool not available — skip silently
          }
        }
      }

      // Update session map
      sessionMap.set(participant.id, participant.sessionId);
    }

    // Inject artifact errors as system guidance for the next round
    if (artifactErrors.length > 0) {
      const errorGuidance = '**System: Artifact Validation Errors:**\n' + artifactErrors.join('\n\n');
      userGuidance = userGuidance ? userGuidance + '\n\n' + errorGuidance : errorGuidance;
    } else {
      // Clear user guidance after it's been used (only if no artifact errors to carry forward)
      userGuidance = undefined;
    }

    // Print round summary table
    printRoundSummary(roundResults, roundFailedIds, roundTokenLimitIds);

    // Update token-limited tracking for next round's prompt injection
    tokenLimitedLastRound.clear();
    for (const pid of roundTokenLimitIds) {
      tokenLimitedLastRound.add(pid);
    }

    // Check consensus
    state.consensusStatus = detectConsensus(state, config.consensusThreshold);
    log('');
    log(`  Consensus status: ${state.consensusStatus}`);

    // Save state JSON after each round
    try {
      saveStateJson(stateJsonPath, state, sessionMap);
    } catch {
      // non-fatal
    }

    if (state.consensusStatus === 'full') {
      log('');
      log('  *** CONSENSUS REACHED ***');
      consensusReached = true;
      break;
    }

    // Tie-breaker phase transitions
    if (tieBreakerPhase === 'lead-proposes') {
      tieBreakerPhase = 'others-respond';
      log('  Tie-breaker: others will respond to the Lead\'s proposal next round.');
    } else if (tieBreakerPhase === 'others-respond') {
      tieBreakerPhase = 'inactive';
    } else if (
      leadParticipant &&
      round >= 2 &&
      (state.consensusStatus === 'disagreement' || state.consensusStatus === 'emerging')
    ) {
      tieBreakerPhase = 'lead-proposes';
      log('');
      log('  *** TIE-BREAKER ACTIVATED ***');
      log(`  ${leadParticipant.displayName()} will issue a final compromise next round.`);
    } else if (
      !leadParticipant &&
      round >= 3 &&
      state.consensusStatus === 'disagreement'
    ) {
      log('');
      log('  Tip: Configure a participant with "lead": true in config for tie-breaker rounds.');
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

  // Final state save
  try {
    saveStateJson(stateJsonPath, state, sessionMap);
  } catch {
    // non-fatal
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
  log(`  State: ${stateJsonPath}`);
  log('========================================');
  log('');

  // Remove SIGINT handler to avoid leak
  process.removeListener('SIGINT', sigintHandler);

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
