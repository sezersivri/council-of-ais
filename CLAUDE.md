# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

multi-ai is an orchestrator that makes Claude Code CLI, OpenAI Codex CLI, and Google Gemini CLI have structured debates. Each AI takes turns responding to a topic, and the orchestrator detects when they reach consensus.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check without emitting
npm run start -- "topic"  # Run via tsx (dev)
npx tsx src/index.ts "topic"  # Run directly

# Usage
npx tsx src/index.ts "Design a REST API" --rounds 5 --participants claude,codex,gemini --watch
```

## Architecture

**Session-persistent invocations**: Each AI CLI is called once per round using its non-interactive mode. Between rounds, session continuation flags (`claude --continue`, `codex exec resume --last`, `gemini --resume latest`) maintain conversation context natively. Only the delta (other AIs' latest responses) is sent each round — not the full history.

### Key flow: `src/orchestrator.ts`
1. Spawns each participant CLI for Round 1 with the full topic + structured format instructions
2. Rounds 2+: sends only what the other AIs said in the previous round (delta prompt)
3. Parses each response for `### Consensus Signal` (AGREE/DISAGREE/PARTIALLY_AGREE)
4. Stops when all participants signal AGREE or max rounds hit
5. First participant generates a final summary

### Participant adapters: `src/participants/`
Each CLI has an adapter (`claude.ts`, `codex.ts`, `gemini.ts`) extending `base.ts`. Adapters handle:
- `buildFirstCommand()` — fresh session invocation
- `buildContinueCommand()` — session continuation
- `parseOutput()` — extract response text (and session ID if available) from CLI output

### Discussion protocol
Responses must follow a structured markdown format with sections: Analysis, Points of Agreement, Points of Disagreement, Proposal, Consensus Signal. Templates live in `templates/`. The consensus detector in `src/consensus.ts` regex-parses these sections.

## Config

`config.default.json` — per-participant settings (CLI path, timeout, model, extra args). Overridden by CLI flags.
