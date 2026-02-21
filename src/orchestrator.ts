import { createInterface } from 'readline';
import { join } from 'path';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import {
  DiscussionState,
  DiscussionEntry,
  MultiAiConfig,
  OrchestrationResult,
  ParticipantId,
  DiscussionResult,
  ParticipantStats,
  RoundData,
} from './types.js';
import {
  initializeDiscussion,
  appendEntry,
  appendFinalPlan,
  appendRichFooter,
  saveStateJson,
  extractDecisions,
  extractActionItems,
} from './discussion.js';
import {
  buildInitialPrompt, buildRoundPrompt, buildStatelessRoundPrompt, buildFinalSummaryPrompt,
  buildTieBreakerLeadPrompt, buildTieBreakerFollowPrompt,
} from './prompt-builder.js';
import { parseResponseSections, extractCodeArtifact, detectConsensus } from './consensus.js';
import { runCliProcess } from './process-runner.js';
import { createParticipant, BaseParticipant } from './participants/index.js';
import { validateArtifact } from './artifact-validator.js';
import { StreamDisplay } from './stream-display.js';
import { evaluateQualityGate } from './quality-gate.js';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

function debugLog(config: MultiAiConfig, event: string, msg: string) {
  if (config.debug) {
    process.stderr.write(`[DEBUG] [${event}] ${msg}\n`);
  }
}

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rnd}`;
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

export function formatDuration(ms: number): string {
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
    participant.cleanupCurrentPromptFile();
    return null;
  }

  // Check for token/context limit before generic failure handling
  if (participant.isTokenLimitError(result)) {
    participant.lastFailureWasTokenLimit = true;
    log(`  [${participant.id}] TOKEN LIMIT reached (${formatDuration(result.durationMs)})`);
    if (verbose && result.stderr) {
      log(`    stderr: ${result.stderr.slice(0, 500)}`);
    }
    participant.cleanupCurrentPromptFile();
    return null;
  }

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    log(`  [${participant.id}] FAILED (exit code ${result.exitCode})`);
    if (verbose && result.stderr) {
      log(`    stderr: ${result.stderr.slice(0, 500)}`);
    }
    participant.cleanupCurrentPromptFile();
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
      const delayMs = 2000 * attempt;
      log(`  [${participant.id}] Retrying (attempt ${attempt + 1}/${maxRetries + 1}) after ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }

    const result = await runParticipantTurn(participant, prompt, cwd, verbose, onStdoutData);
    if (result) return result;

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

let cleanupDone = false;
function cleanupTempDir() {
  if (cleanupDone) return;
  cleanupDone = true;
  const tmpDir = join(process.cwd(), '.multi-ai-tmp');
  if (existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export function selectSummarizer(
  participants: BaseParticipant[],
  permanentlyFailed: Set<ParticipantId>,
  state: DiscussionState,
): BaseParticipant {
  const available = participants.filter((p) => !permanentlyFailed.has(p.id));
  const lead = available.find((p) => p.config.lead);
  if (lead) return lead;
  // Count AGREE signals per participant across all rounds
  const agreeCounts = new Map<ParticipantId, number>();
  for (const entry of state.entries) {
    if (entry.parsedSections?.consensusSignal === 'AGREE') {
      agreeCounts.set(entry.participant, (agreeCounts.get(entry.participant) ?? 0) + 1);
    }
  }
  return available.sort(
    (a, b) => (agreeCounts.get(b.id) ?? 0) - (agreeCounts.get(a.id) ?? 0),
  )[0] ?? participants[0];
}

/**
 * Core discussion loop. Accepts pre-created participants for testability.
 * @internal exported for testing
 */
export async function runDiscussionWithParticipants(
  topic: string,
  config: MultiAiConfig,
  activeParticipants: BaseParticipant[],
): Promise<DiscussionResult> {
  const startTime = Date.now();
  const runId = generateRunId();
  const outputPath = join(config.outputDir, config.outputFile);
  const stateJsonPath = join(config.outputDir, 'discussion-state.json');

  if (activeParticipants.length < 2) {
    throw new Error('At least 2 participants are required for a discussion');
  }

  // Participant stats tracking
  const statsMap = new Map<ParticipantId, { rounds: number; failures: number; totalMs: number }>(
    activeParticipants.map((p) => [p.id, { rounds: 0, failures: 0, totalMs: 0 }]),
  );

  // Round data for rich output and JSON report
  const roundDataList: RoundData[] = [];

  // Dry-run: print Round 1 prompts and exit without invoking CLIs
  if (config.dryRun) {
    log('\n=== DRY RUN — Round 1 prompts (no CLIs invoked) ===\n');
    for (const p of activeParticipants) {
      const prompt = buildInitialPrompt(topic, p.id, 1, config.maxRounds, p.config.role);
      log(`\n--- ${p.displayName()} ---\n${prompt}`);
    }
    return buildResult(runId, topic, config, activeParticipants, statsMap, [], null, false, false, startTime);
  }

  const participantIds = activeParticipants.map((p) => p.id);

  // Initialize discussion file
  const state = initializeDiscussion(outputPath, topic, participantIds);

  // Graduated failure policy
  const roundFailureCount = new Map<ParticipantId, number>();
  const permanentlyFailed = new Set<ParticipantId>();

  // Track participants that hit token limit last round
  const tokenLimitedLastRound = new Set<ParticipantId>();

  // Build session map for state persistence
  const sessionMap = new Map<ParticipantId, string | undefined>();
  for (const p of activeParticipants) {
    sessionMap.set(p.id, undefined);
  }

  // SIGINT handler
  let sigintReceived = false;
  const sigintHandler = () => {
    if (sigintReceived) {
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

  const exitHandler = () => cleanupTempDir();
  process.on('exit', exitHandler);

  log('');
  log('========================================');
  log('  Multi-AI Discussion');
  log('========================================');
  log(`  Topic: ${topic}`);
  log(`  Run ID: ${runId}`);
  log('  Participants:');
  for (const p of activeParticipants) {
    log(`    ${p.displayName().padEnd(20)} — ${p.modelDisplay()}`);
  }
  log(`  Max rounds: ${config.maxRounds}`);
  log(`  Mode: ${config.watch ? 'Interactive (--watch)' : 'Automated'}`);
  if (config.validateArtifacts) log('  Artifact validation: ON');
  if (config.stream) log('  Streaming display: ON');
  if (config.debug) log('  Debug logging: ON (stderr)');
  if (config.ci) log('  CI mode: ON');
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
  let userGuidance: string | undefined = config.projectGuidance;

  // Stall detection
  let staleRoundsCount = 0;
  const lastProposals = new Map<ParticipantId, string>();

  let lastRound = 0;

  for (let round = 1; round <= config.maxRounds; round++) {
    lastRound = round;
    const roundStart = Date.now();
    log(`--- Round ${round} of ${config.maxRounds} ---`);
    log('');

    const roundParticipants = activeParticipants.filter(
      (p) => !permanentlyFailed.has(p.id),
    );

    if (roundParticipants.length < 2) {
      log('  Too few participants remaining, ending discussion.');
      break;
    }

    // Build prompts
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
      } else if (participant.isStateless() && round > 1) {
        debugLog(config, 'STATELESS_INJECT', `${participant.id} is stateless — building full-context prompt`);
        prompt = buildStatelessRoundPrompt(state, participant.id, round, config.maxRounds, userGuidance);
      } else {
        const isFreshSession = !participant.sessionStarted && round > 1;
        if (isFreshSession) {
          debugLog(config, 'CATCHUP_INJECT', `${participant.id} has no session — injecting catch-up context`);
        }
        prompt = buildRoundPrompt(state, participant.id, round, config.maxRounds, userGuidance, isFreshSession);
      }

      if (round > 1 && permanentlyFailed.size > 0) {
        const failedList = Array.from(permanentlyFailed).join(', ');
        prompt += `\n\n**Note:** The following participants have dropped out due to failures: ${failedList}. Continue the discussion with remaining participants.`;
      }

      participantPrompts.set(participant, prompt);
    }

    const executionParticipants = (tieBreakerPhase === 'lead-proposes' && leadParticipant)
      ? roundParticipants.filter((p) => p.id === leadParticipant.id)
      : roundParticipants;

    const useStreaming = config.stream && process.stdout.isTTY;
    let streamDisplay: StreamDisplay | undefined;

    if (useStreaming) {
      streamDisplay = new StreamDisplay(executionParticipants.map((p) => p.id));
      streamDisplay.start();
    } else {
      for (const participant of executionParticipants) {
        log(`  [${participant.id}] Thinking...`);
      }
    }

    const results = await Promise.allSettled(
      executionParticipants.map(async (participant) => {
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
          if (result) streamDisplay.onDone(participant.id);
          else streamDisplay.onFailed(participant.id);
        }
        return { participant, result };
      }),
    );

    streamDisplay?.stop();

    const roundResults: RoundEntryResult[] = [];
    const roundFailedIds = new Set<ParticipantId>();
    const roundTokenLimitIds = new Set<ParticipantId>();
    const artifactErrors: string[] = [];

    for (const settled of results) {
      if (settled.status === 'rejected') {
        log(`  [unknown] Unexpected error: ${settled.reason}`);
        continue;
      }

      const { participant, result } = settled.value;

      if (!result) {
        roundFailedIds.add(participant.id);
        const stats = statsMap.get(participant.id);
        if (stats) stats.failures++;

        if (participant.lastFailureWasTokenLimit) {
          roundTokenLimitIds.add(participant.id);
          participant.resetSession();
          debugLog(config, 'SESSION_RESET', `${participant.id} session reset after token limit`);
          log('');
          log(`  WARNING: [${participant.id}] hit token/context limit — session reset, will rejoin next round`);
        } else {
          if (!useStreaming) log(`  [${participant.id}] Failed all retries`);
          const newCount = (roundFailureCount.get(participant.id) ?? 0) + 1;
          roundFailureCount.set(participant.id, newCount);
          debugLog(config, 'FAILURE_INCREMENT', `${participant.id} failure count = ${newCount}`);
          if (newCount >= 2) {
            permanentlyFailed.add(participant.id);
            debugLog(config, 'PERMANENT_REMOVE', `${participant.id} permanently removed after ${newCount} consecutive failures`);
            log(`  [${participant.id}] Permanently removed after ${newCount} consecutive round failures`);
          }
        }
        continue;
      }

      // Success: reset failure counter, update stats
      roundFailureCount.set(participant.id, 0);
      const stats = statsMap.get(participant.id);
      if (stats) {
        stats.rounds++;
        stats.totalMs += result.durationMs;
      }

      let parsedSections = parseResponseSections(result.response);
      let finalResponse = result.response;

      if (!parsedSections && participant.sessionStarted) {
        const repairPrompt =
          'Your previous response could not be parsed. Please reformat using exactly these sections:\n' +
          '### Analysis\n### Points of Agreement\n### Points of Disagreement\n### Proposal\n### Consensus Signal\n' +
          'Write AGREE, PARTIALLY_AGREE, or DISAGREE under Consensus Signal.';
        debugLog(config, 'REPAIR_REPROMPT', `${participant.id} malformed output — sending repair reprompt`);
        log(`  [${participant.id}] Malformed output — sending repair reprompt...`);
        const repairResult = await runParticipantTurn(
          participant, repairPrompt, process.cwd(), config.verbose,
        );
        if (repairResult) {
          const repairedSections = parseResponseSections(repairResult.response);
          if (repairedSections) {
            finalResponse = repairResult.response;
            parsedSections = repairedSections;
          }
        }
      }

      const signal = parsedSections?.consensusSignal || 'UNKNOWN';

      const entry: DiscussionEntry = {
        round,
        participant: participant.id,
        timestamp: new Date().toISOString(),
        rawResponse: finalResponse,
        parsedSections,
      };

      appendEntry(outputPath, state, entry);
      roundResults.push({ entry, durationMs: result.durationMs });

      if (!useStreaming) {
        log(`  [${participant.id}] Done (${formatDuration(result.durationMs)}) — Signal: ${signal}`);
      }

      if (config.validateArtifacts) {
        const artifact = extractCodeArtifact(finalResponse);
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

      sessionMap.set(participant.id, participant.sessionId);
    }

    // Record round data
    const roundDurationMs = Date.now() - roundStart;
    const roundConsensusStatus = detectConsensus(state, config.consensusThreshold);
    roundDataList.push({
      round,
      entries: roundResults.map((r) => r.entry),
      consensusStatus: roundConsensusStatus,
      durationMs: roundDurationMs,
    });

    if (artifactErrors.length > 0) {
      const errorGuidance = '**System: Artifact Validation Errors:**\n' + artifactErrors.join('\n\n');
      userGuidance = userGuidance ? userGuidance + '\n\n' + errorGuidance : errorGuidance;
    } else {
      userGuidance = config.projectGuidance;
    }

    printRoundSummary(roundResults, roundFailedIds, roundTokenLimitIds);

    tokenLimitedLastRound.clear();
    for (const pid of roundTokenLimitIds) {
      tokenLimitedLastRound.add(pid);
    }

    state.consensusStatus = roundConsensusStatus;
    log('');
    log(`  Consensus status: ${state.consensusStatus}`);

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

    // Stall detection
    if (state.consensusStatus === 'disagreement') {
      const currentProposals = new Map<ParticipantId, string>();
      for (const { entry } of roundResults) {
        if (entry.parsedSections?.proposal) {
          currentProposals.set(entry.participant as ParticipantId, entry.parsedSections.proposal);
        }
      }
      const stagnantCount = Array.from(currentProposals.entries())
        .filter(([id, p]) => lastProposals.get(id) === p).length;
      if (currentProposals.size > 0 && stagnantCount > currentProposals.size / 2) {
        staleRoundsCount++;
        debugLog(config, 'STALL_DETECT', `staleRoundsCount = ${staleRoundsCount}`);
      } else {
        staleRoundsCount = 0;
      }
      for (const [id, p] of currentProposals) lastProposals.set(id, p);
    } else {
      staleRoundsCount = 0;
    }

    // Tie-breaker transitions
    if (tieBreakerPhase === 'lead-proposes') {
      tieBreakerPhase = 'others-respond';
      log('  Tie-breaker: others will respond to the Lead\'s proposal next round.');
    } else if (tieBreakerPhase === 'others-respond') {
      tieBreakerPhase = 'inactive';
    } else if (leadParticipant && staleRoundsCount >= 2 && state.consensusStatus === 'disagreement') {
      tieBreakerPhase = 'lead-proposes';
      staleRoundsCount = 0;
      debugLog(config, 'TIEBREAKER_ACTIVATE', `${leadParticipant.id} will issue a final compromise next round`);
      log('');
      log('  *** TIE-BREAKER ACTIVATED ***');
      log(`  ${leadParticipant.displayName()} will issue a final compromise next round.`);
    } else if (!leadParticipant && staleRoundsCount >= 2 && state.consensusStatus === 'disagreement') {
      log('');
      log('  Tip: Configure a participant with "lead": true in config for tie-breaker rounds.');
    }

    if (config.watch && round < config.maxRounds) {
      log('');
      const input = await promptUser(
        '  [Enter] continue | [s] stop | or type guidance for next round: ',
      );

      if (input.toLowerCase() === 's') {
        log('  Stopping discussion by user request.');
        break;
      } else if (input.length > 0) {
        userGuidance = userGuidance ? userGuidance + '\n\n' + input : input;
        log(`  Guidance noted: "${input}"`);
      }
      log('');
    }
  }

  // Generate final summary
  log('');
  log('Generating final summary...');

  const summarizer = selectSummarizer(activeParticipants, permanentlyFailed, state);
  const summaryPrompt = buildFinalSummaryPrompt(state);

  const summaryResult = await runParticipantTurn(
    summarizer,
    summaryPrompt,
    process.cwd(),
    config.verbose,
  );

  const finalSummary = summaryResult?.response ?? '*Failed to generate final summary. See discussion above.*';
  appendFinalPlan(outputPath, state, finalSummary, consensusReached);

  // Evaluate quality gate
  const maxRoundsReached = !consensusReached && lastRound >= config.maxRounds;
  const qualityGate = evaluateQualityGate(state, consensusReached, maxRoundsReached);
  debugLog(config, 'QUALITY_GATE', `gate=${qualityGate}, consensusReached=${consensusReached}, maxRoundsReached=${maxRoundsReached}`);

  // Append rich markdown footer
  appendRichFooter(outputPath, state, roundDataList, Date.now() - startTime, consensusReached, runId);

  // Final state save
  try {
    saveStateJson(stateJsonPath, state, sessionMap);
  } catch {
    // non-fatal
  }

  const totalMs = Date.now() - startTime;
  const actualMaxRound = state.entries.reduce((m, e) => Math.max(m, e.round), 0);

  log('');
  log('========================================');
  log('  Discussion Complete');
  log('========================================');
  log(`  Rounds: ${actualMaxRound}`);
  log(`  Consensus: ${consensusReached ? 'YES' : 'NO'}`);
  log(`  Quality gate: ${qualityGate.toUpperCase()}`);
  log(`  Duration: ${formatDuration(totalMs)}`);
  log(`  Output: ${outputPath}`);
  log(`  State: ${stateJsonPath}`);
  log('========================================');
  log('');

  process.removeListener('SIGINT', sigintHandler);
  process.removeListener('exit', exitHandler);

  const result = buildResult(
    runId, topic, config, activeParticipants, statsMap,
    roundDataList, state, consensusReached, maxRoundsReached, startTime,
    qualityGate, finalSummary,
  );

  // Write JSON report
  if (config.jsonReport) {
    const reportPath = config.jsonReport;
    const reportDir = reportPath.includes('/') || reportPath.includes('\\')
      ? reportPath.split(/[/\\]/).slice(0, -1).join('/')
      : '.';
    if (reportDir && reportDir !== '.' && !existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
    log(`  JSON report: ${reportPath}`);
  }

  return result;
}

function buildResult(
  runId: string,
  topic: string,
  config: MultiAiConfig,
  activeParticipants: BaseParticipant[],
  statsMap: Map<ParticipantId, { rounds: number; failures: number; totalMs: number }>,
  roundDataList: RoundData[],
  state: DiscussionState | null,
  consensusReached: boolean,
  maxRoundsReached: boolean,
  startTime: number,
  qualityGate?: import('./types.js').QualityGate,
  finalSummary?: string,
): DiscussionResult {
  const totalMs = Date.now() - startTime;

  let status: import('./types.js').RunStatus = 'no_consensus';
  if (consensusReached && (qualityGate === 'pass' || qualityGate === 'warn')) {
    status = 'consensus';
  } else if (state && state.consensusStatus === 'partial') {
    status = 'partial';
  } else if (!state) {
    status = 'failure';
  }

  const participants: import('./types.js').ParticipantStats[] = activeParticipants.map((p) => {
    const s = statsMap.get(p.id) ?? { rounds: 0, failures: 0, totalMs: 0 };
    return {
      id: p.id,
      rounds: s.rounds,
      failures: s.failures,
      avgResponseMs: s.rounds > 0 ? Math.round(s.totalMs / s.rounds) : 0,
    };
  });

  const summary = finalSummary ?? '';
  const maxRound = state ? state.entries.reduce((m, e) => Math.max(m, e.round), 0) : 0;
  const decisions = state ? extractDecisions(summary, maxRound) : [];
  const actionItems = state ? extractActionItems(summary) : [];

  return {
    runId,
    status,
    consensusReached,
    roundCount: roundDataList.length,
    durationMs: totalMs,
    qualityGate: qualityGate ?? 'fail',
    finalSummary: summary,
    decisions,
    actionItems,
    participants,
    transcript: roundDataList,
  };
}

/**
 * Public library API: run a full discussion and return a structured result.
 */
export async function runDiscussion(
  topic: string,
  config: MultiAiConfig,
): Promise<DiscussionResult> {
  const participants = config.participants
    .filter((p) => p.enabled)
    .map((p) => createParticipant(p));

  if (participants.length < 2) {
    throw new Error('At least 2 participants are required for a discussion');
  }

  if (!config.skipPreflight) {
    await runPreflightChecks(participants);
  }

  return runDiscussionWithParticipants(topic, config, participants);
}

/**
 * Legacy-compatible wrapper that returns OrchestrationResult.
 * Prefer runDiscussion() for new code.
 */
export async function orchestrate(
  topic: string,
  config: MultiAiConfig,
): Promise<OrchestrationResult> {
  const result = await runDiscussion(topic, config);
  return {
    topic,
    totalRounds: result.roundCount,
    consensusReached: result.consensusReached,
    finalPlan: result.finalSummary || null,
    discussionFilePath: join(config.outputDir, config.outputFile),
    participants: result.participants.map((p) => p.id as ParticipantId),
    durationMs: result.durationMs,
  };
}
