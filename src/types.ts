export type ParticipantId = string;

export type ConsensusStatus = 'emerging' | 'partial' | 'full' | 'disagreement';

export type ConsensusSignal = 'AGREE' | 'AGREE_WITH_RESERVATION' | 'DISAGREE' | 'PARTIALLY_AGREE';

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
  /** Reservation text from AGREE_WITH_RESERVATION signal (≥20 words) */
  reservation?: string;
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

export interface StdinBodyConfig {
  /** Base JSON object — deep-cloned each round. e.g. {"model":"llama3","stream":false} */
  template: Record<string, unknown>;
  /** Field name where the prompt string is injected. e.g. "prompt" */
  promptField: string;
  /** Field name where extracted session state is injected on continue rounds. e.g. "context" */
  stateField?: string;
}

export interface GenericSessionConfig {
  /** Regex with one capture group to extract string session ID from stdout */
  extractPattern?: string;   // was required, now optional
  /** Args to append on continue invocations; use {sessionId} as placeholder */
  continueArgs?: string[];   // was required, now optional
  /** JSON field name to extract from response as complex session state (e.g. Ollama context array) */
  extractField?: string;
}

export interface ParticipantConfig {
  id: ParticipantId;
  /** 'generic' opts into GenericParticipant; omit for built-in adapters */
  type?: 'generic';
  enabled: boolean;
  /** Command to run (e.g. 'ollama', 'curl'). For generics this is the executable. */
  cliPath: string;
  model?: string;
  timeoutMs: number;
  systemPrompt?: string;
  /** Base arguments appended before the prompt (for generic type) */
  extraArgs?: string[];
  role?: string;
  lead?: boolean;
  maxRetries?: number;
  /** Generic only: how to deliver the prompt to the process */
  inputMode?: 'stdin' | 'arg';
  /** Generic only: explicit flag name for arg mode (e.g. '--prompt') */
  promptArg?: string;
  /** Generic only: opt-in session state; omit for stateless (default) */
  session?: GenericSessionConfig;
  /** Generic only: parse stdout as JSON and extract this field as the response */
  jsonField?: string;
  /** Generic only: additional env vars for the subprocess */
  genericEnv?: Record<string, string>;
  /** Generic only: structured JSON body for stdin-mode tools (e.g. Ollama REST via curl) */
  stdinBody?: StdinBodyConfig;
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
  /** Blind draft sub-round before peer context injection in rounds 2+ */
  independentDraft?: boolean;
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
