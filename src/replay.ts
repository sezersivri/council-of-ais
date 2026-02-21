import { readFileSync } from 'fs';
import { DiscussionState } from './types.js';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

export function replay(statePath: string): void {
  let state: DiscussionState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf-8')) as DiscussionState;
  } catch (err) {
    throw new Error(`Failed to read state file: ${statePath}\n${err instanceof Error ? err.message : err}`);
  }

  log('');
  log('========================================');
  log('  Multi-AI Discussion Replay');
  log('========================================');
  log(`  Topic: ${state.topic.slice(0, 80)}${state.topic.length > 80 ? '...' : ''}`);
  log(`  Started: ${state.startedAt}`);
  log(`  Participants: ${state.participants.join(', ')}`);
  log(`  Entries: ${state.entries.length}`);
  log('========================================');

  if (state.entries.length === 0) {
    log('\n(No discussion entries to replay.)');
  } else {
    let currentRound = 0;
    for (const entry of state.entries) {
      if (entry.round !== currentRound) {
        currentRound = entry.round;
        log('');
        log(`--- Round ${currentRound} ---`);
      }
      log('');
      log(`## ${entry.participant.toUpperCase()} — ${entry.timestamp}`);
      if (entry.parsedSections) {
        const s = entry.parsedSections;
        if (s.analysis) log(`\n### Analysis\n${s.analysis}`);
        if (s.pointsOfAgreement.length > 0) log(`\n### Points of Agreement\n${s.pointsOfAgreement.map(p => `- ${p}`).join('\n')}`);
        if (s.pointsOfDisagreement.length > 0) log(`\n### Points of Disagreement\n${s.pointsOfDisagreement.map(p => `- ${p}`).join('\n')}`);
        if (s.proposal) log(`\n### Proposal\n${s.proposal}`);
        log(`\n### Consensus Signal\n${s.consensusSignal}`);
      } else {
        log(entry.rawResponse);
      }
      log('---');
    }
  }

  if (state.finalPlan) {
    log('');
    log('# Final Consensus Plan');
    log('');
    log(state.finalPlan);
  }

  log('');
  log('========================================');
  log('  End of Replay');
  log('========================================');
  log('');
}
