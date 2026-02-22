# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

multi-ai (Council of AIs) is an orchestrator that makes Claude Code CLI, OpenAI Codex CLI, Google Gemini CLI, and any generic CLI tool hold structured debates. Each AI takes turns responding to a topic in a structured format, and the orchestrator detects when they reach consensus.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check without emitting
npm run start -- "topic"  # Run via tsx (dev)
npx tsx src/index.ts "topic"  # Run directly
npm test               # Run all tests (174 tests)
npm run update-models  # Probe CLIs, update model names in config files
npm run self-review    # Self-review discussion via topics/self-review.md

# Common usage
npx tsx src/index.ts "Design a REST API" --rounds 5 --participants claude,codex,gemini --watch
npx tsx src/index.ts --topic-file topics/my-topic.md --ci
npx tsx src/index.ts "topic" --dry-run   # Print prompts only, no CLI calls
npx tsx src/index.ts --replay ./output/discussion-state.json
```

## Architecture

### Session model

- **Built-in participants** (claude, codex, gemini): session-persistent. Each CLI is invoked once per round; between rounds, continuation flags (`claude --resume <id>`, `codex exec resume --session <id>`, `gemini --resume <id>`) maintain conversation context natively. Only the delta (other AIs' latest responses) is sent each round.
- **Generic participants** (`"type": "generic"`): stateless by default. The full compressed context (topic + consensus status + history summary + delta) is prepended to every prompt via `buildStatelessRoundPrompt()`. Opt-in session via `session` config (string ID or `extractField` for complex state like Ollama's integer array).

### Key flow: `src/orchestrator.ts`

1. Spawn each enabled participant for Round 1 with the full topic + format instructions (parallel)
2. Rounds 2+: send only what the others said last round (delta prompt); use `buildStatelessRoundPrompt` for stateless participants
3. Parse each response for `### Consensus Signal` (AGREE / PARTIALLY_AGREE / DISAGREE)
4. Graduated failure: 2 consecutive failures → permanent removal; others notified
5. Stall detection: 2 rounds without signal change → tie-breaker activation (lead participant)
6. Stop when all participants signal AGREE (or threshold met) or max rounds hit
7. `selectSummarizer()` picks the lead, or most-AGREE participant, to generate final summary
8. Evaluate quality gate (`src/quality-gate.ts`); write JSON report if configured
9. Exit with code 0 (consensus+pass), 1 (no consensus/warn/fail), or 2 (infrastructure error)

### Participant adapters: `src/participants/`

| File | Description |
|------|-------------|
| `base.ts` | Abstract base: `buildFirstCommand()`, `buildContinueCommand()`, `parseOutput()`, `isStateless()`, `displayName()`, `isTokenLimitError()` (checks stderr only) |
| `claude.ts` | JSON output mode; randomised temp file; `--resume <sessionId>`; overrides `isTokenLimitError` to also check `is_error` in stdout JSON |
| `codex.ts` | `codex exec "msg"` / `codex exec resume --session <id> "msg"`; randomised temp file |
| `gemini.ts` | Prompt via stdin; `GEMINI_MODEL` env var (not `-m` flag); `--resume <id>` or `latest` fallback |
| `generic.ts` | Config-driven; `stdinBody` for JSON body construction; `extractField` for complex session state; ReDoS check on user-supplied `extractPattern` |
| `index.ts` | Factory: routes `type === 'generic'` to `GenericParticipant`; built-in IDs to their adapters |

### Discussion protocol (High-Signal Protocol)

Round 2+ responses must use exactly three sections:

```
### Substance
Position, reasoning, concrete plan. No preamble.

### Deltas
+/-/~ bullets for position changes (or "None")

### Consensus Signal
AGREE  (or PARTIALLY_AGREE or DISAGREE)
```

Round 1 uses `templates/initial-prompt.md` (fuller format). Templates live in `templates/`. The consensus detector in `src/consensus.ts` regex-parses all sections.

Round 3+ adds convergence pressure: first line of Substance must be `Merging with @Agent` or `Holding: [reason]`.

### Prompt building: `src/prompt-builder.ts`

- `buildInitialPrompt()` — Round 1, template substitution
- `buildRoundPrompt()` — Round 2+ delta prompt; injects convergence instruction at round 3+
- `buildStatelessRoundPrompt()` — wraps delta prompt with full compressed context header (for generic participants)
- `buildTieBreakerLeadPrompt()` / `buildTieBreakerFollowPrompt()` — tie-breaker phase prompts
- `buildFinalSummaryPrompt()` — post-consensus summary
- `getParticipantName(id)` — returns display name for built-ins; falls back to raw ID for generics

## Config

### Auto-discovery order

1. `--config <path>` (explicit)
2. `multi-ai.json` in CWD (auto-discovered)
3. `config.default.json` (bundled default)

CLI flags override file values.

### Key config fields

```jsonc
{
  "maxRounds": 5,            // clamped to [1, 50]
  "consensusThreshold": 1,   // fraction of participants that must AGREE
  "outputDir": "./output",
  "outputFile": "discussion.md",
  "verbose": false,
  "watch": false,
  "debug": false,            // state-transition logs to stderr
  "guidance": "",            // appended to every prompt (use for project context)
  "participants": [
    {
      "id": "claude",
      "enabled": true,
      "cliPath": "claude",
      "model": "claude-opus-4-6",
      "timeoutMs": 120000,   // clamped to [5000, 600000]
      "maxRetries": 1,
      "role": "Security Architect",
      "lead": false,         // tie-breaker lead
      "extraArgs": []
    },
    // Generic participant example (Ollama):
    {
      "id": "llama3",
      "type": "generic",
      "enabled": true,
      "cliPath": "curl",
      "inputMode": "arg",
      "extraArgs": ["-s", "-X", "POST", "http://localhost:11434/api/generate"],
      "stdinBody": {
        "template": { "model": "llama3", "stream": false },
        "promptField": "prompt",
        "stateField": "context"
      },
      "jsonField": "response",
      "session": { "extractField": "context" }
    }
  ]
}
```

### Security constraints

- `safeResolvePath()` in `config.ts`: rejects output paths that escape beyond the grandparent of CWD (blocks `../../../../etc/hosts` style traversal)
- `validateConfig()`: clamps numeric fields to safe ranges
- `extractPattern` in generic session config: pre-checked for nested quantifiers (ReDoS prevention) before `new RegExp()` is called
- Temp files use `randomBytes(8).toString('hex')` in filenames
- `stripAnsi()` in `process-runner.ts` covers CSI, OSC, ESC sequences, and bare control chars
- Windows `shell:true` args are double-quoted to prevent injection

## Key file locations

| Path | Purpose |
|------|---------|
| `src/orchestrator.ts` | Main orchestration loop |
| `src/participants/base.ts` | Base class; `isTokenLimitError` checks stderr only |
| `src/participants/claude.ts` | `isTokenLimitError` override for JSON error detection |
| `src/participants/gemini.ts` | GEMINI_MODEL env var (not -m flag) |
| `src/participants/generic.ts` | GenericParticipant with stdinBody + extractField |
| `src/quality-gate.ts` | Structural pass/warn/fail; no LLM judge |
| `src/replay.ts` | `--replay` flag implementation |
| `src/model-detector.ts` | MODEL_PRIORITY list; Gemini trusts GEMINI_MODEL env var |
| `src/config.ts` | loadConfig, safeResolvePath, validateConfig |
| `src/prompt-builder.ts` | All prompt construction including stateless context injection |
| `config.default.json` | Default participant settings |
| `config.self-review.json` | Self-review run config (5 rounds, 180s timeout) |
| `topics/self-review.md` | Self-review discussion topic |
| `scripts/test-clis.ts` | Smoke-test installed CLIs |
| `scripts/update-models.ts` | Probes CLIs, writes model names to config files |
| `tests/` | 174 unit + integration tests |
