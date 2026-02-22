# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What This Is

**Council of AIs** — an orchestrator that makes Claude Code CLI, OpenAI Codex CLI, Google Gemini CLI, and any generic CLI tool hold structured debates. Each AI takes turns responding to a topic, and the orchestrator detects consensus.

---

## Commands

```bash
npm run build            # Compile TypeScript → dist/
npm run typecheck        # Type-check without emitting
npm run start -- "topic" # Run via tsx (dev)
npx tsx src/index.ts "topic"   # Run directly

npm test                 # 174 tests
npm run update-models    # Probe CLIs, update model names in config files
npm run self-review      # Self-review discussion (topics/self-review.md)

# Common invocations
npx tsx src/index.ts "Design a REST API" --rounds 5 --participants claude,codex,gemini
npx tsx src/index.ts --topic-file topics/my-topic.md --ci
npx tsx src/index.ts "topic" --dry-run
npx tsx src/index.ts --replay ./output/discussion-state.json
```

---

## Architecture

### Session model

**Built-in participants** (claude, codex, gemini): session-persistent. Each CLI is invoked once per round; continuation flags (`claude --resume <id>`, `codex exec resume --session <id>`, `gemini --resume <id>`) maintain conversation context natively. Only the delta is sent each round.

**Generic participants** (`"type": "generic"`): stateless by default. Full compressed context (topic + consensus status + history summary + delta) prepended every round via `buildStatelessRoundPrompt()`. Opt-in session via `config.session` (string ID via `continueArgs`, or `extractField` for complex state like Ollama's integer context array).

### Orchestrator flow (`src/orchestrator.ts`)

1. Spawn all enabled participants for Round 1 in parallel (full topic + format instructions)
2. Parse each response for `### Consensus Signal` (AGREE / PARTIALLY_AGREE / DISAGREE)
3. Graduated failure: 2 consecutive failures → permanent removal; remaining participants notified
4. Rounds 2+: send delta prompt; use `buildStatelessRoundPrompt()` for stateless participants
5. Stall detection: 2 rounds without signal change → tie-breaker activation (`lead` participant)
6. Stop when all participants signal AGREE (or threshold met) or max rounds hit
7. `selectSummarizer()` picks the lead, or highest AGREE count, to write the final summary
8. Evaluate quality gate (`src/quality-gate.ts`) → pass / warn / fail
9. Write JSON report if `--json-report` or `--ci` configured
10. Exit 0 (consensus + pass), 1 (no consensus / warn / fail), 2 (infrastructure error)

### Output naming (`src/index.ts`)

Every run auto-generates a unique output filename — no more overwriting `discussion.md`:

```
{slug}-{YYYYMMDD-HHmmss}.md
```

- `--topic-file topics/api-review.md` → `api-review-20260222-143012.md`
- `"Design a REST API"` (argument) → `design-a-rest-api-20260222-143012.md`
- `--output my-file.md` → `my-file.md` (explicit override, no auto-naming)

### Participant adapters (`src/participants/`)

| File | Description |
|------|-------------|
| `base.ts` | Abstract base: `buildFirstCommand()`, `buildContinueCommand()`, `parseOutput()`, `isStateless()` (returns `false`), `displayName()`, `isTokenLimitError()` (checks **stderr only**) |
| `claude.ts` | JSON output mode; randomised temp file (`randomBytes(8).hex()`); `--resume <sessionId>`; overrides `isTokenLimitError()` to also check `is_error` in stdout JSON |
| `codex.ts` | `codex exec "msg"` / `codex exec resume --session <id> "msg"`; randomised temp file |
| `gemini.ts` | Prompt via stdin; `GEMINI_MODEL` env var (not `-m` flag); `--resume <id>` or `latest` fallback |
| `generic.ts` | Config-driven; `stdinBody` for JSON body construction; `extractField` for complex session state; ReDoS check on user-supplied `extractPattern`; `resetSession()` clears `sessionState` |
| `index.ts` | Factory: routes `type === 'generic'` to `GenericParticipant`; built-in IDs to their adapters |

### Discussion protocol — High-Signal Protocol

Round 2+ responses (3 compact sections):

```
### Substance
Position, reasoning, concrete plan. No preamble.
Round 3+: first line must be "Merging with @Agent" or "Holding: [reason]"

### Deltas
+/-/~ bullets for position changes, or "None"

### Consensus Signal
AGREE  (or PARTIALLY_AGREE or DISAGREE)
```

Round 1 uses `templates/initial-prompt.md` (fuller format). The consensus detector in `src/consensus.ts` regex-parses all sections.

### Prompt building (`src/prompt-builder.ts`)

| Function | Purpose |
|----------|---------|
| `buildInitialPrompt()` | Round 1 template substitution |
| `buildRoundPrompt()` | Round 2+ delta; injects convergence instruction at round 3+ |
| `buildStatelessRoundPrompt()` | Wraps delta with full context header (for generic/stateless participants) |
| `buildTieBreakerLeadPrompt()` | Tie-breaker: lead synthesis prompt |
| `buildTieBreakerFollowPrompt()` | Tie-breaker: follower vote prompt |
| `buildFinalSummaryPrompt()` | Post-consensus summary |
| `getParticipantName(id)` | Returns display name for built-ins; falls back to raw ID for generics |

---

## Config

### Auto-discovery order

1. `--config <path>` (explicit flag)
2. `multi-ai.json` in CWD (auto-discovered)
3. `config.default.json` (bundled default)

CLI flags always override file values.

### Key config fields

```jsonc
{
  "maxRounds": 5,           // clamped to [1, 50]
  "consensusThreshold": 1,  // fraction of participants that must AGREE
  "outputDir": "./output",
  // "outputFile" omitted → auto-generated as {slug}-{timestamp}.md
  "verbose": false,
  "watch": false,
  "debug": false,           // state-transition logs to stderr
  "guidance": "",           // appended to every prompt (project context)

  "participants": [
    {
      // Built-in
      "id": "claude",
      "enabled": true,
      "cliPath": "claude",
      "model": "claude-opus-4-6",
      "timeoutMs": 120000,  // clamped to [5000, 600000]
      "maxRetries": 1,
      "role": "Security Architect",
      "lead": false,
      "extraArgs": []
    },
    {
      // Generic — Ollama example
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

---

## Security constraints

| Area | Implementation |
|------|----------------|
| Path traversal | `safeResolvePath()` in `config.ts`: rejects paths escaping beyond CWD grandparent |
| Config bounds | `validateConfig()`: clamps `maxRounds` [1,50], `timeoutMs` [5000,600000] |
| ReDoS | User-supplied `extractPattern` pre-checked for nested quantifiers before `new RegExp()` |
| Temp files | `randomBytes(8).toString('hex')` in filenames (claude.ts, codex.ts) |
| ANSI stripping | 4-regex `stripAnsi()` covers CSI, OSC, ESC sequences, bare control chars |
| Windows injection | Args are double-quoted when `shell: true` on Windows |
| Token limit errors | `isTokenLimitError()` checks **stderr only** — prevents false positives when AIs discuss token limits in their responses |

---

## Key file locations

| Path | Purpose |
|------|---------|
| `src/index.ts` | CLI entry; `buildOutputFilename()` for auto-naming |
| `src/orchestrator.ts` | Main loop, tie-breaker, quality gate, JSON report |
| `src/participants/base.ts` | `isTokenLimitError()` — stderr only |
| `src/participants/claude.ts` | `isTokenLimitError()` override for JSON error detection |
| `src/participants/gemini.ts` | GEMINI_MODEL env var (not -m flag) |
| `src/participants/generic.ts` | GenericParticipant: stdinBody, extractField, ReDoS check |
| `src/quality-gate.ts` | Structural pass/warn/fail; no LLM judge |
| `src/replay.ts` | `--replay` flag implementation |
| `src/model-detector.ts` | MODEL_PRIORITY list; Gemini trusts GEMINI_MODEL env var |
| `src/config.ts` | loadConfig, safeResolvePath, validateConfig |
| `src/prompt-builder.ts` | All prompt construction including stateless context injection |
| `config.default.json` | Default participant settings (claude-opus-4-6, gpt-5.3-codex, gemini-3-pro-preview) |
| `config.self-review.json` | Self-review run config (5 rounds, 180s timeout) |
| `topics/` | Discussion topic files (markdown) |
| `scripts/test-clis.ts` | Smoke-test installed CLIs |
| `scripts/update-models.ts` | Probes CLIs, writes model names to config |
| `tests/` | 174 unit + mocked E2E tests across 40 suites |

---

## Notes for future development

- **Model names are non-negotiable**: `claude-opus-4-6`, `gpt-5.3-codex`, `gemini-3-pro-preview` — do not change without explicit user approval.
- **Gemini model selection**: set `GEMINI_MODEL` env var; the `-m` flag does not work for preview models in non-interactive subprocess mode.
- **`isTokenLimitError()` must check stderr only** — AIs frequently discuss "token limits" and "context windows" in their responses, causing false positives if stdout is also scanned.
- **Generic participants are stateless by default** — they get full context injected; only opt into session if the tool genuinely maintains state between calls.
