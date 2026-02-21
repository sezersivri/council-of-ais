export type ParticipantId = 'claude' | 'codex' | 'gemini';

export type ConsensusStatus = 'emerging' | 'partial' | 'full' | 'disagreement';

export type ConsensusSignal = 'AGREE' | 'DISAGREE' | 'PARTIALLY_AGREE';

export type QualityGate = 'pass' | 'warn' | 'fail';

export type RunStatus = 'consensus' | 'partial' | 'no_consensus' | 'failure';

export interface ResponseSections {
  /** New format: merged analysis+proposal */
  substance: string;
  /** New format: +/-/~ delta bullets */
  deltas: string[];
  /** New format: convergence line extracted from Substance (round 3+) */
  convergence: string | null;
  /** Legacy compat: = substance when new format; = proposal text when old format */
  analysis: string;
  pointsOfAgreement: string[];
  pointsOfDisagreement: string[];
  proposal: string;
  consensusSignal: ConsensusSignal;
}

export interface DiscussionEntry {
  round: number;
  participant: ParticipantId;
  timestamp: string;
  rawResponse: string;
  parsedSections: ResponseSections | null;
}

export interface DiscussionState {
  topic: string;
  participants: ParticipantId[];
  startedAt: string;
  entries: DiscussionEntry[];
  consensusStatus: ConsensusStatus;
  finalPlan: string | null;
}

export interface ParticipantConfig {
  id: ParticipantId;
  enabled: boolean;
  cliPath: string;
  model?: string;
  timeoutMs: number;
  systemPrompt?: string;
  extraArgs?: string[];
  role?: string;
  lead?: boolean;
  maxRetries?: number;
}

export interface MultiAiConfig {
  maxRounds: number;
  participants: ParticipantConfig[];
  outputDir: string;
  outputFile: string;
  consensusThreshold: number;
  verbose: boolean;
  watch: boolean;
  validateArtifacts: boolean;
  stream: boolean;
  dryRun?: boolean;
  debug?: boolean;
  jsonReport?: string;
  ci?: boolean;
  projectGuidance?: string;
  /** Skip CLI preflight checks — for testing only */
  skipPreflight?: boolean;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface ParticipantOutput {
  response: string;
  sessionId?: string;
}

export interface RoundResult {
  roundNumber: number;
  entries: DiscussionEntry[];
  consensusStatus: ConsensusStatus;
}

export interface DecisionItem {
  decision: string;
  status: 'accepted' | 'rejected' | 'open';
  round: number;
}

export interface ActionItem {
  item: string;
  priority: string;
  rationale: string;
}

export interface ParticipantStats {
  id: string;
  rounds: number;
  failures: number;
  avgResponseMs: number;
}

export interface RoundData {
  round: number;
  entries: DiscussionEntry[];
  consensusStatus: ConsensusStatus;
  durationMs: number;
}

export interface DiscussionResult {
  runId: string;
  status: RunStatus;
  consensusReached: boolean;
  roundCount: number;
  durationMs: number;
  qualityGate: QualityGate;
  finalSummary: string;
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  participants: ParticipantStats[];
  transcript: RoundData[];
}

export interface OrchestrationResult {
  topic: string;
  totalRounds: number;
  consensusReached: boolean;
  finalPlan: string | null;
  discussionFilePath: string;
  participants: ParticipantId[];
  durationMs: number;
}
