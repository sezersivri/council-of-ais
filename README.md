# Council of AIs

An orchestrator that makes **Claude Code CLI**, **OpenAI Codex CLI**, **Google Gemini CLI**, and **any other CLI tool** hold structured debates. Each AI takes turns responding to a topic, and the orchestrator detects when they reach consensus.

## How It Works

```
You: "Design a REST API for a task management app"

         ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────┐
         │  Claude  │   │  Codex  │   │ Gemini  │   │ Any CLI* │
         └────┬─────┘   └────┬────┘   └────┬────┘   └────┬─────┘
              │              │              │              │
  Round 1     ├──────────────┼──────────────┼──────────────┤  (parallel)
              ▼              ▼              ▼              ▼
         ┌────────────────────────────────────────────────────┐
         │  Orchestrator collects responses,                  │
         │  parses consensus signals, writes transcript       │
         └──────────────────────┬─────────────────────────────┘
                                │
  Round 2+   Each AI sees only what the others said (delta)
              ├──────────────┼──────────────┤
              ▼              ▼              ▼
         ┌─────────────────────────────────────┐
         │  AGREE / PARTIALLY_AGREE / DISAGREE │
         └──────────────────┬──────────────────┘
                            │
         ... repeats until consensus or max rounds ...
                            │
                            ▼
              Final Summary + Rich Markdown Transcript
              + Optional JSON Report (--json-report / --ci)
```

*Any CLI tool or REST API can participate via `"type": "generic"` in config — including local models via Ollama.

**Key design choices:**

- **Session-persistent** (built-ins): Each CLI is called once per round. Continuation flags (`claude --resume`, `codex exec resume --session`, `gemini --resume`) preserve conversation context between rounds natively.
- **Stateless generics**: Custom participants receive full compressed context (topic + history + delta) each round — no session memory needed.
- **Delta-only prompts**: Only what the *other* AIs said last round is sent — not the full history.
- **Parallel execution**: All participants run concurrently each round.
- **Graduated failure**: 2 consecutive failures → participant permanently removed. Others continue.
- **Auto-named output**: Every run produces a unique file like `design-a-rest-api-20260222-143012.md` — no more overwriting `discussion.md`.

---

## Prerequisites

At least **two** of these CLIs installed and authenticated:

| CLI | Install | Auth |
|-----|---------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | `claude` (follow prompts) |
| [OpenAI Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | `export OPENAI_API_KEY=...` |
| [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | `gemini` (follow prompts) |

Or use **any** local/remote CLI tool via the [generic adapter](#custom-participants-any-cli-tool).

Node.js >= 20 required.

---

## Install

```bash
git clone https://github.com/sezersivri/council-of-ais.git
cd council-of-ais
npm install
npm run build
```

---

## Usage

```bash
# Basic — all three AIs discuss a topic (5 rounds max)
npx tsx src/index.ts "Design a REST API for a task management app"
# Output: ./output/design-a-rest-api-for-a-task-management-20260222-143012.md

# Pick participants and rounds
npx tsx src/index.ts "Compare REST vs GraphQL" --rounds 3 --participants claude,codex

# Read topic from a file (great for long prompts, code reviews, project briefs)
npx tsx src/index.ts --topic-file topics/my-topic.md
# Output: ./output/my-topic-20260222-143012.md

# Explicit output filename (overrides auto-naming)
npx tsx src/index.ts "Topic" --output my-discussion.md

# Interactive mode — pause between rounds to steer the discussion
npx tsx src/index.ts "Design a microservices architecture" --watch

# Live streaming spinner (shows bytes received per participant)
npx tsx src/index.ts "Best practices for error handling" --stream

# Dry run — print Round 1 prompts without calling any CLI
npx tsx src/index.ts "My topic" --dry-run

# Debug — structured state-transition logs on stderr
npx tsx src/index.ts "My topic" --debug

# Machine-readable JSON report
npx tsx src/index.ts "API design" --json-report ./result.json

# CI mode — JSON report at ./result.json + enforced exit codes
npx tsx src/index.ts "API design" --ci

# Replay a saved transcript
npx tsx src/index.ts --replay ./output/discussion-state.json

# Validate code artifacts (runs tsc/node --check on ### Code Artifact blocks)
npx tsx src/index.ts "Implement a cache layer" --validate-artifacts
```

---

## CLI Reference

```
Usage: multi-ai [options] [topic]

Arguments:
  topic                         The topic or question for the AIs to discuss

Options:
  --topic-file <path>           Read topic from a markdown or text file
  -r, --rounds <number>         Maximum discussion rounds (default: 5)
  -p, --participants <list>     Comma-separated participant IDs
                                  Built-ins: claude,codex,gemini
                                  Custom: any ID defined in multi-ai.json
                                  (default: claude,codex,gemini)
  -o, --output <file>           Output filename
                                  Default: auto-generated as {slug}-{YYYYMMDD-HHmmss}.md
                                  e.g. design-a-rest-api-20260222-143012.md
  -c, --config <path>           Path to config JSON (default: auto-discover multi-ai.json)
  -w, --watch                   Interactive: pause between rounds for user input
  -v, --verbose                 Show CLI commands and stderr output
      --stream                  Live ANSI spinner — bytes received per participant
      --dry-run                 Print Round 1 prompts and exit (no CLI calls)
      --debug                   Structured state-transition logs to stderr
      --json-report <path>      Write DiscussionResult JSON to this path
      --ci                      CI mode: --json-report ./result.json + enforced exit codes
      --replay <path>           Format and print a saved discussion-state.json
      --validate-artifacts      Parse ### Code Artifact blocks, run tsc/node --check
      --skip-preflight          Skip CLI availability checks (for testing)
  -V, --version                 Show version
  -h, --help                    Show help
```

### Output Naming

Every run auto-generates a unique filename so discussions never overwrite each other:

| Input | Output filename |
|-------|----------------|
| `"Design a REST API"` | `design-a-rest-api-20260222-143012.md` |
| `--topic-file topics/api-review.md` | `api-review-20260222-143012.md` |
| `--output custom.md` | `custom.md` (explicit override) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Full consensus reached + quality gate passed |
| `1` | No consensus, max rounds hit, or quality gate warn/fail |
| `2` | Infrastructure error (CLI not found, all participants failed) |

### Interactive Mode (`--watch`)

Between each round you can:
- Press **Enter** — continue normally
- Type **s** — stop the discussion early
- Type **any text** — inject guidance into the next round (e.g. `"focus more on security"`)

---

## Output Files

Every run writes to `./output/` (configurable via `outputDir`):

| File | Contents |
|------|----------|
| `{slug}-{timestamp}.md` | Full markdown transcript: TOC, round table, consensus trajectory chart, final proposals |
| `discussion-state.json` | Machine-readable state: session IDs, consensus status, timing metadata |
| `result.json` | Structured `DiscussionResult` (only with `--json-report` or `--ci`) |

### JSON Report Schema

```typescript
interface DiscussionResult {
  runId: string;           // timestamp-based unique ID
  status: 'consensus' | 'partial' | 'no_consensus' | 'failure';
  consensusReached: boolean;
  roundCount: number;
  durationMs: number;
  qualityGate: 'pass' | 'warn' | 'fail';
  finalSummary: string;
  decisions: { decision: string; status: 'accepted'|'rejected'|'open'; round: number }[];
  actionItems: { item: string; priority: string; rationale: string }[];
  participants: { id: string; rounds: number; failures: number; avgResponseMs: number }[];
  transcript: RoundData[];
}
```

After each round, a summary table is printed to the terminal:

```
  ┌───────────┬──────────────────┬─────────┐
  │ claude    │ AGREE            │  45.2s  │
  │ codex     │ PARTIALLY_AGREE  │  32.1s  │
  │ gemini    │ AGREE            │  28.8s  │
  └───────────┴──────────────────┴─────────┘
```

---

## Configuration

### Auto-Discovery

Place `multi-ai.json` in your project directory — it's picked up automatically without `--config`:

```json
{
  "maxRounds": 4,
  "guidance": "Focus on TypeScript and Node.js. Prefer minimal dependencies.",
  "participants": [
    { "id": "claude", "enabled": true, "role": "Security Architect" },
    { "id": "codex",  "enabled": true, "role": "Performance Engineer" },
    { "id": "gemini", "enabled": false }
  ]
}
```

**Priority order:**
1. `--config <path>` (explicit flag)
2. `multi-ai.json` in current working directory
3. `config.default.json` (bundled fallback)

CLI flags always override file values.

### Full Config Reference

```jsonc
{
  // Discussion control
  "maxRounds": 5,             // Clamped to [1, 50]
  "consensusThreshold": 1,    // 1.0 = all must AGREE, 0.66 = two-thirds majority

  // Output
  "outputDir": "./output",    // Where to write discussion files
  "outputFile": "custom.md",  // Override auto-naming (usually omit this)

  // Behaviour flags
  "verbose": false,
  "watch": false,
  "debug": false,             // State-transition logs on stderr

  // Context
  "guidance": "",             // String appended to every prompt (project context, constraints)

  // Participants
  "participants": [
    {
      // --- All participant types ---
      "id": "claude",         // Unique identifier
      "enabled": true,
      "cliPath": "claude",    // Executable path
      "model": "claude-opus-4-6",
      "timeoutMs": 120000,    // Clamped to [5000, 600000]
      "maxRetries": 1,        // Retry count on failure (exponential backoff)
      "role": "Security Architect",  // Optional persona injected into prompts
      "lead": false,          // Mark one participant as tie-breaker lead
      "extraArgs": [],        // Extra CLI flags prepended before the prompt

      // --- Generic participants only (add "type": "generic") ---
      "type": "generic",
      "inputMode": "stdin",   // "stdin" (default) or "arg"
      "promptArg": "--prompt",// Flag name for arg mode
      "jsonField": "response",// Parse stdout as JSON and extract this field
      "genericEnv": {},       // Extra env vars for the subprocess

      // JSON body construction (for REST-style tools like Ollama)
      "stdinBody": {
        "template": { "model": "llama3", "stream": false },
        "promptField": "prompt",   // Where to inject the prompt text
        "stateField": "context"    // Where to inject session state (optional)
      },

      // Session state (generic only)
      "session": {
        "extractPattern": "session-id: ([a-f0-9-]+)",  // Regex to extract string ID
        "continueArgs": ["--session", "{sessionId}"],   // Args for round 2+ (string ID)
        "extractField": "context"                        // JSON field for complex state
      }
    }
  ]
}
```

### Persona Roles

Without roles, LLMs tend to agree quickly on safe answers. Roles force multi-dimensional analysis:

```json
{ "id": "claude", "role": "Security Architect" },
{ "id": "codex",  "role": "Performance Engineer" },
{ "id": "gemini", "role": "Developer Experience Advocate" }
```

### Tie-breaker

Set `"lead": true` on one participant. If the discussion stalls for 2+ rounds without signal change, that participant proposes a synthesis and the others vote to accept or reject it.

---

## Custom Participants (Any CLI Tool)

Add `"type": "generic"` to make any CLI tool a discussion participant. Generic participants are **stateless by default** — they receive full compressed context every round, so they don't need session memory.

### Ollama (local model via REST API)

```json
{
  "id": "llama3",
  "type": "generic",
  "enabled": true,
  "cliPath": "curl",
  "timeoutMs": 60000,
  "inputMode": "arg",
  "extraArgs": ["-s", "-X", "POST", "http://localhost:11434/api/generate"],
  "stdinBody": {
    "template": { "model": "llama3", "stream": false },
    "promptField": "prompt",
    "stateField": "context"
  },
  "jsonField": "response",
  "session": {
    "extractField": "context"
  }
}
```

Sends `{"model":"llama3","stream":false,"prompt":"..."}` to Ollama. The `context` integer array from each response is stored and re-injected in the next request — giving Ollama proper session memory across rounds.

### Simple stdin/stdout CLI

```json
{
  "id": "my-llm",
  "type": "generic",
  "enabled": true,
  "cliPath": "my-llm-cli",
  "timeoutMs": 30000,
  "extraArgs": ["--no-color"]
}
```

### Argument-mode CLI

```json
{
  "id": "my-tool",
  "type": "generic",
  "enabled": true,
  "cliPath": "my-tool",
  "inputMode": "arg",
  "promptArg": "--prompt",
  "extraArgs": ["--format", "text"]
}
```

### Session-aware CLI (string session ID)

```json
{
  "id": "my-stateful-cli",
  "type": "generic",
  "enabled": true,
  "cliPath": "my-cli",
  "session": {
    "extractPattern": "session-id: ([a-f0-9-]+)",
    "continueArgs": ["--session", "{sessionId}"]
  }
}
```

### Generic Config Fields Quick Reference

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"generic"` | Required — opts into GenericParticipant |
| `cliPath` | string | Executable to invoke |
| `inputMode` | `"stdin"` \| `"arg"` | How the prompt is delivered (default: `"stdin"`) |
| `promptArg` | string | Flag name for arg mode, e.g. `"--prompt"` |
| `extraArgs` | string[] | Args prepended before the prompt each round |
| `stdinBody` | object | JSON body template for REST-style tools |
| `jsonField` | string | Extract this field from JSON stdout as the response |
| `session.extractPattern` | string | Regex (one capture group) to extract a string session ID |
| `session.continueArgs` | string[] | Args appended on round 2+; `{sessionId}` is substituted |
| `session.extractField` | string | JSON field for complex session state (arrays, objects) |
| `genericEnv` | object | Additional env vars for the subprocess |

---

## Discussion Protocol (High-Signal Protocol)

Rounds 2+ use a compact 3-section format:

```markdown
### Substance
Your position, reasoning, and concrete plan. No preamble.
(Round 3+: first line must be "Merging with @Agent" or "Holding: [one-sentence reason]")

### Deltas
+ Point you now agree with after seeing others' responses
- Point you're dropping or revising
~ Nuance or qualification you're adding
(Write "None" if no changes)

### Consensus Signal
AGREE
```

Valid signals: `AGREE`, `PARTIALLY_AGREE`, `DISAGREE`.

Round 1 uses a fuller template (`templates/initial-prompt.md`). The consensus detector in `src/consensus.ts` regex-parses all sections.

---

## Resilience Features

| Feature | Description |
|---------|-------------|
| **Graduated failure** | 2 consecutive failures → participant permanently removed; others notified |
| **Retry with backoff** | Configurable `maxRetries` (default: 1), exponential delay (2s, 4s, …) |
| **Catch-up context** | Session reset mid-discussion? Participant gets compressed history before the delta |
| **Repair reprompt** | Malformed response → one-shot correction prompt before counting as failure |
| **Tie-breaker** | 2 stalled rounds → `lead` participant proposes synthesis; others vote |
| **Quality gate** | Structural pass/warn/fail on final round (no LLM judge) — drives exit code |
| **SIGINT handling** | Ctrl+C flushes state to `discussion-state.json` before exiting |
| **Session isolation** | Claude uses `--resume <sessionId>` — never hijacks your active Claude Code session |
| **Temp file security** | Randomised filenames (`randomBytes(8).hex()`) prevent predictable temp paths |
| **Path safety** | Output paths validated against directory traversal (blocks `../../../../etc/`) |
| **5 MB buffer cap** | stdout/stderr truncated at 5 MB per participant to prevent memory exhaustion |
| **ReDoS defense** | User-supplied `extractPattern` checked for nested quantifiers before compilation |

---

## Development

```bash
npm run build            # Compile TypeScript → dist/
npm run typecheck        # Type-check without emitting
npm run start -- "topic" # Run via tsx (dev mode)
npm test                 # Run 174 tests (unit + mocked E2E)
npm run update-models    # Probe installed CLIs, update model names in config files
npm run self-review      # Run a self-review discussion (topics/self-review.md)
```

---

## Architecture

```
src/
├── index.ts              # CLI entry point; auto-names output files
├── orchestrator.ts       # Main loop: parallel rounds, retry, consensus, tie-breaker
├── consensus.ts          # Regex parser for structured response sections
├── discussion.ts         # Markdown + JSON writers; rich footer (TOC, chart, table)
├── prompt-builder.ts     # Template substitution; buildStatelessRoundPrompt for generics
├── process-runner.ts     # Child process spawner with timeout + ANSI stripping
├── quality-gate.ts       # Structural pass/warn/fail evaluation
├── replay.ts             # --replay: format and print saved transcripts
├── model-detector.ts     # Probes CLIs to auto-detect available models
├── config.ts             # loadConfig, safeResolvePath, validateConfig, auto-discovery
├── types.ts              # All TypeScript interfaces (DiscussionResult, ParticipantConfig, …)
└── participants/
    ├── base.ts           # Abstract base: isStateless(), displayName(), isTokenLimitError()
    ├── claude.ts         # Claude Code adapter (JSON output, randomised temp file, --resume)
    ├── codex.ts          # Codex adapter (exec resume --session, randomised temp file)
    ├── gemini.ts         # Gemini adapter (GEMINI_MODEL env var, --resume)
    ├── generic.ts        # Config-driven adapter for any CLI or REST API
    └── index.ts          # Factory: routes type=generic vs built-in IDs

templates/
├── initial-prompt.md             # Round 1 prompt
├── round-prompt.md               # Round 2+ delta prompt (High-Signal Protocol)
├── tiebreaker-lead-prompt.md     # Tie-breaker: lead synthesis prompt
├── tiebreaker-follow-prompt.md   # Tie-breaker: follower vote prompt
└── final-summary-prompt.md       # Post-consensus summary prompt

topics/
├── self-review.md        # Self-review discussion topic
├── ollama-session.md     # Ollama session design (agent-generated)
└── agent-souls-review.md # Agent Souls architecture review

scripts/
├── test-clis.ts          # Smoke-test all installed participant CLIs
├── update-models.ts      # Probe CLIs and write model names to config files
└── test-codex-prompt.ts  # Manual Codex prompt test helper

tests/                    # 174 tests across 40 suites
```

---

## License

MIT
