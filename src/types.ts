export type ParticipantId = 'claude' | 'codex' | 'gemini';

export type ConsensusStatus = 'emerging' | 'partial' | 'full' | 'disagreement';

export type ConsensusSignal = 'AGREE' | 'DISAGREE' | 'PARTIALLY_AGREE';

export interface ResponseSections {
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

export interface OrchestrationResult {
  topic: string;
  totalRounds: number;
  consensusReached: boolean;
  finalPlan: string | null;
  discussionFilePath: string;
  participants: ParticipantId[];
  durationMs: number;
}
