You are advising on the **multi-ai** project — a Node.js/TypeScript CLI that orchestrates Claude Code CLI, OpenAI Codex CLI, and Google Gemini CLI into a structured debate until they reach consensus.

## What was just implemented (the Grand Plan, all 14 items)

A 4-round self-review discussion between all three AIs reached full consensus on improvements. All of them were just implemented:

### Tier 1 — Bug Fixes
1. **Exclusive lead phase**: During `lead-proposes` tie-breaker phase, only the lead participant runs — non-lead CLIs are no longer invoked unnecessarily.
2. **No `shell: true`**: Removed from `child_process.spawn()` — eliminates command injection risk and Windows quoting bugs.
3. **Idempotent cleanup**: `cleanupTempDir()` has a `cleanupDone` guard — SIGINT → exit no longer runs cleanup twice.
4. **`userGuidance` append**: Watch-mode user input now appends to existing guidance (e.g. artifact errors) instead of overwriting it.
5. **Smart summarizer (`selectSummarizer`)**: Final summary writer is chosen by priority: Lead > highest AGREE count > first non-failed participant.
6. **Codex no `--last` fallback**: When no session ID is captured, `buildContinueCommand` calls `buildFirstCommand` instead of `--last` (which could resume a wrong parallel session).
7. **Temp file pre-clean + `cleanupCurrentPromptFile()`**: Claude and Codex clean up their previous temp prompt file before writing a new one. A `cleanupCurrentPromptFile()` hook is called on all timeout / token-limit / failure paths.

### Tier 2 — Reliability
8. **Graduated failure policy**: A `roundFailureCount` map tracks consecutive failures. Participants are permanently removed only after **2 consecutive failures** (not immediately after 1).
9. **Context recovery (isFreshSession)**: When a participant rejoins after a session reset, `buildRoundPrompt` prepends a catch-up packet containing the original topic summary, format rules, and last round's proposals.
10. **Repair reprompt**: When `parseResponseSections` returns null (malformed output), the orchestrator immediately sends a single in-session repair request before recording the entry.
11. **Stall-based tie-breaker**: Tie-breaker activates after `staleRoundsCount >= 2` rounds of proposal stagnation — not just after `round >= 2`.
12. **Buffer caps**: stdout and stderr are capped at 5MB with a truncation marker — prevents OOM on verbose CLI output.

### Tier 3 — New Features
13. **`--dry-run` flag**: Prints Round 1 prompts for all participants and exits without invoking any CLIs. Useful for validating prompt content before a real run.
14. **`--replay <path>` flag**: Reads a saved `discussion-state.json` and formats it as a readable transcript without hitting any CLIs. New `src/replay.ts` module.

## Current architecture (post-implementation)

- **Execution**: Parallel `Promise.allSettled` per round; `executionParticipants` filtered for exclusive lead phase
- **Session continuity**: resume flags per CLI; fresh-session catch-up packet on rejoin
- **Structured format**: Analysis / Points of Agreement / Points of Disagreement / Proposal / Consensus Signal
- **Consensus detection**: full → partial → emerging → disagreement
- **Reliability**: graduated failure, repair reprompt, 5MB buffer cap, idempotent cleanup
- **Tie-breaker**: stall-based activation (≥2 stagnant rounds), lead-proposes then others-respond
- **Test suite**: 149 tests across 9 files, Node.js built-in `node:test`, zero extra deps

## What was explicitly NOT done (rejected in prior discussion)

- Finite-state round engine / state machine rewrite
- Quorum scheduling with soft deadlines
- Issue ledger injected into every prompt
- `--skip`, `--suspend-after`, `--quorum`, `--persist-guidance` flags
- Permissive section-header regex expansion
- Conditional Analysis inclusion in deltas

## Your task

Now that the architecture is significantly more robust, discuss what the **next phase** of improvements should be.

Consider:
1. **What new capabilities** would make multi-ai meaningfully more useful to developers running real discussions?
2. **What reliability gaps** remain that could still cause silent failures or bad output in production runs?
3. **What observability or tooling** is missing — logging, metrics, debugging, configuration?
4. **What would make the output better** — summary quality, transcript format, consensus detection accuracy?
5. **Integrations** — should multi-ai be embeddable as a library? Support webhooks, CI/CD pipelines, or other CLIs beyond the current three?

Be specific. Propose concrete, actionable next steps. Prioritize ruthlessly — what matters most?
