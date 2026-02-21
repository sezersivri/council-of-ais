You are performing a technical review of **multi-ai** — the tool that is currently running you.

## What multi-ai is

A Node.js/TypeScript CLI that orchestrates three AI CLIs (Claude Code CLI, OpenAI Codex CLI, Google Gemini CLI) into a structured debate until they reach consensus. Each AI is a subprocess. No extra runtime dependencies (only `commander`).

## Architecture

- **Execution**: All participants run in parallel per round via `Promise.allSettled` + `child_process.spawn`
- **Session continuity**: `claude --resume <id>`, `codex exec resume --session <id>`, `gemini --resume <id>` — only the delta (other AIs' proposal + points) is sent each round, not full history
- **Structured format**: Every response must have sections — Analysis / Points of Agreement / Points of Disagreement / Proposal / Consensus Signal (AGREE / PARTIALLY_AGREE / DISAGREE)
- **Consensus detection**: full (all AGREE) → partial (≥66% agree/partial) → emerging (some) → disagreement (none)
- **Retry logic**: configurable `maxRetries` per participant with exponential backoff
- **Token limit recovery**: if a participant hits context limit, their session is reset and they rejoin the next round fresh
- **Tie-breaker**: a designated `"lead": true` participant proposes a compromise after full disagreement; others respond in the following round
- **Artifact validation**: extracts fenced code blocks, runs `tsc --noEmit` or `node --check`, injects errors into next round's prompt
- **Watch mode**: human can inject guidance between rounds or stop early
- **Streaming display**: live ANSI spinners with byte counts, no deps

## Known limitations and edge cases

- Tie-breaker activates on round count alone, not tracked stall duration
- In the lead-proposes phase, non-lead participants still run with regular prompts (not skipped)
- No replay mode — can't re-run a saved `discussion-state.json` without hitting the CLIs again
- No way to skip a single participant for one round
- Session IDs from CLIs are trusted without validation
- The final summary always uses `activeParticipants[0]` — the first participant — regardless of who performed best
- `process.on('exit')` cleanup runs even after SIGINT (double cleanup path)
- Watch-mode user guidance is cleared after each round unless artifact errors exist (may surprise users)

## Your task

Critically review this architecture and propose concrete improvements. Consider:

1. **Bugs and edge cases** likely to cause failures in real multi-round runs
2. **Architectural improvements** — session management, error handling, prompt design
3. **Missing features** that would make this significantly more useful
4. **Performance and efficiency** — token usage, parallelism, latency
5. **Reliability** — what breaks under real-world CLI behaviour (crashes, slow responses, malformed output)

Be specific. Reference the architecture details above. Propose actionable changes.
