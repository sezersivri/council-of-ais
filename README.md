# Council of AIs

An orchestrator that makes **Claude Code CLI**, **OpenAI Codex CLI**, **Google Gemini CLI**, and **any other CLI tool** hold structured debates. Each AI takes turns responding to a topic, and the orchestrator detects when they reach consensus.

## How It Works

```
You: "Design a REST API for a task management app"

         ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
         │  Claude  │   │  Codex  │   │ Gemini  │   │  Any*   │
         └────┬─────┘   └────┬────┘   └────┬────┘   └────┬────┘
              │              │              │              │
  Round 1     ├──────────────┼──────────────┼──────────────┤  (parallel)
              ▼              ▼              ▼              ▼
         ┌─────────────────────────────────────────────────┐
         │  Orchestrator collects responses,               │
         │  detects consensus signals, writes transcript   │
         └──────────────────────┬──────────────────────────┘
                                │
  Round 2     Each AI sees what the others said (delta only)
              ├──────────────┼──────────────┤
              ▼              ▼              ▼
         ┌─────────────────────────────────────┐
         │  AGREE / PARTIALLY_AGREE / DISAGREE │
         └──────────────────┬──────────────────┘
                            │
              ... repeats until consensus or max rounds ...
                            │
                            ▼
                   Final Summary Document + JSON Report
```

*Any CLI tool or REST API can participate via `"type": "generic"` config — including local models via Ollama.

Key design choices:
- **Session-persistent** (built-ins): Each CLI is called once per round. Session continuation flags (`claude --resume`, `codex exec resume`, `gemini --resume`) maintain conversation context natively.
- **Stateless generics**: Custom/generic participants receive a full compressed context each round instead of relying on session memory.
- **Delta-only prompts**: Only what the *other* AIs said last round is sent — not the full history.
- **Parallel execution**: All participants run concurrently each round (~3x faster than sequential).
- **Graceful degradation**: Graduated failure counter — 2 strikes and a participant is permanently removed. Others continue and are informed of the dropout.

## Prerequisites

You need at least **two** of these CLIs installed and authenticated:

| CLI | Install | Auth |
|-----|---------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | `claude` (follow prompts) |
| [OpenAI Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | `export OPENAI_API_KEY=...` |
| [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | `gemini` (follow prompts) |

Or use **any** local/remote CLI tool via the generic adapter (see [Custom Participants](#custom-participants)).

Node.js >= 20 required.

## Install

```bash
git clone https://github.com/sezersivri/council-of-ais.git
cd council-of-ais
npm install
npm run build
```

## Usage

```bash
# Basic: all three AIs discuss a topic (5 rounds max)
npx tsx src/index.ts "Design a REST API for a task management app"

# Pick participants and rounds
npx tsx src/index.ts "Compare REST vs GraphQL" --rounds 3 --participants claude,codex

# From a topic file (supports long prompts with full context)
npx tsx src/index.ts --topic-file topics/my-topic.md

# Interactive mode: pause between rounds to steer the discussion
npx tsx src/index.ts "Design a microservices architecture" --watch

# Stream live output with ANSI spinner
npx tsx src/index.ts "Best practices for error handling" --stream

# CI mode: writes result.json, enforces exit codes
npx tsx src/index.ts "API design" --ci

# Write machine-readable JSON report
npx tsx src/index.ts "Database schema design" --json-report ./result.json

# Dry run: print Round 1 prompts without calling any CLI
npx tsx src/index.ts "My topic" --dry-run

# Replay a saved discussion transcript
npx tsx src/index.ts --replay ./output/discussion-state.json

# Debug: state-transition logs on stderr
npx tsx src/index.ts "Topic" --debug
```

### CLI Options

```
Usage: multi-ai [options] [topic]

Arguments:
  topic                         The topic or question for the AIs to discuss

Options:
  -r, --rounds <number>         Maximum discussion rounds (default: 5)
  -p, --participants <list>     Comma-separated participant IDs (default: all enabled)
  -o, --output <file>           Output markdown filename (default: discussion.md)
  -c, --config <path>           Path to custom config JSON (default: auto-discover multi-ai.json)
      --topic-file <path>       Read topic from a file instead of argument
  -w, --watch                   Interactive mode — pause between rounds for user input
  -v, --verbose                 Show CLI commands and stderr
      --stream                  Live ANSI spinner showing bytes received per participant
      --dry-run                 Print Round 1 prompts and exit (no CLI calls)
      --debug                   Structured state-transition logs to stderr
      --json-report <path>      Write DiscussionResult JSON to this path
      --ci                      CI mode: --json-report ./result.json + enforced exit codes
      --replay <path>           Format and print a saved discussion-state.json
      --validate-artifacts      Parse ### Code Artifact blocks, run tsc/node --check, inject errors
      --skip-preflight          Skip CLI availability checks (for testing)
  -V, --version                 Show version
  -h, --help                    Show help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Full consensus reached, quality gate passed |
| `1` | No consensus, max rounds hit, or quality gate warn/fail |
| `2` | Infrastructure error (no CLIs found, all participants failed) |

### Interactive Mode (`--watch`)

Between each round, you can:
- Press **Enter** to continue normally
- Type **s** to stop the discussion early
- Type **any text** to inject guidance into the next round (e.g., "focus more on security concerns")

## Output

Each run produces files in `./output/` (configurable):

| File | Contents |
|------|----------|
| `discussion.md` | Full markdown transcript with TOC, round table, consensus trajectory chart |
| `discussion-state.json` | Machine-readable state: session IDs, consensus status, timing |
| `result.json` | Structured `DiscussionResult` (with `--json-report` or `--ci`) |

The JSON report schema:
```typescript
interface DiscussionResult {
  runId: string;                 // timestamp-based unique ID
  status: 'consensus' | 'partial' | 'no_consensus' | 'failure';
  consensusReached: boolean;
  roundCount: number;
  durationMs: number;
  qualityGate: 'pass' | 'warn' | 'fail';
  finalSummary: string;
  decisions: Array<{ decision: string; status: 'accepted'|'rejected'|'open'; round: number }>;
  actionItems: Array<{ item: string; priority: string; rationale: string }>;
  participants: Array<{ id: string; rounds: number; failures: number; avgResponseMs: number }>;
  transcript: Array<RoundData>;
}
```

After each round, a summary table is printed:

```
  ┌───────────┬──────────────────┬─────────┐
  │ claude    │ AGREE            │  45.2s  │
  │ codex     │ PARTIALLY_AGREE  │  32.1s  │
  │ gemini    │ AGREE            │  28.8s  │
  └───────────┴──────────────────┴─────────┘
```

## Configuration

### Auto-discovery

Place a `multi-ai.json` in your project directory — it's picked up automatically without `--config`:

```json
{
  "maxRounds": 5,
  "guidance": "Focus on TypeScript and Node.js solutions.",
  "participants": [
    { "id": "claude", "enabled": true, "role": "Security Architect" },
    { "id": "codex",  "enabled": true, "role": "Performance Engineer" }
  ]
}
```

CLI flags always override file values.

### Full Config Reference

```jsonc
{
  "maxRounds": 5,                  // clamped to [1, 50]
  "consensusThreshold": 1,         // 1.0 = all must AGREE, 0.66 = two-thirds
  "outputDir": "./output",
  "outputFile": "discussion.md",
  "verbose": false,
  "watch": false,
  "debug": false,
  "guidance": "",                  // string appended to every prompt (project context)
  "participants": [
    {
      "id": "claude",
      "enabled": true,
      "cliPath": "claude",
      "model": "claude-opus-4-6",
      "timeoutMs": 120000,         // clamped to [5000, 600000]
      "maxRetries": 1,
      "role": "Security Architect",// optional persona
      "lead": false,               // set true on one participant to enable tie-breaker
      "extraArgs": []
    }
    // ... codex, gemini, or any generic participant
  ]
}
```

### Persona Roles

Without roles, LLMs tend to converge quickly on "safe" answers. Assigning roles forces multi-dimensional analysis:

```json
{ "id": "claude", "role": "Security Architect" },
{ "id": "codex",  "role": "Performance Engineer" },
{ "id": "gemini", "role": "Developer Experience Advocate" }
```

### Tie-breaker

If discussion stalls for 2+ rounds without progress, a participant marked `"lead": true` takes over, proposes a synthesis, and the others vote to accept or reject it.

## Custom Participants

Any CLI tool or REST endpoint can join the discussion via `"type": "generic"`.

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

This sends `{"model":"llama3","stream":false,"prompt":"..."}` to the Ollama REST API. The `context` integer array from each response is stored and injected back into the next request body, giving Ollama proper session memory across rounds.

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

The prompt is sent via stdin; stdout is the response.

### CLI with argument-mode input

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

#### Generic Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"generic"` | Required to opt into GenericParticipant |
| `cliPath` | string | Executable to run |
| `inputMode` | `"stdin"` \| `"arg"` | How the prompt is delivered (default: `"stdin"`) |
| `promptArg` | string | Flag name for arg mode (e.g. `"--prompt"`) |
| `extraArgs` | string[] | Args prepended before the prompt |
| `stdinBody` | object | JSON body template for REST-style tools (see Ollama example) |
| `jsonField` | string | Parse stdout as JSON and extract this field as the response |
| `session.extractPattern` | string | Regex with one capture group to extract a string session ID |
| `session.continueArgs` | string[] | Args appended on round 2+; `{sessionId}` is replaced |
| `session.extractField` | string | JSON field to extract as complex session state (arrays, objects) |
| `genericEnv` | object | Additional env vars for the subprocess |

## Discussion Protocol

The High-Signal Protocol used in rounds 2+ (3 compact sections):

```
### Substance
Your position, reasoning, and concrete plan. No preamble.

### Deltas
+ Point you now agree with after seeing others' responses
- Point you're dropping or revising
~ Nuance you're adding

### Consensus Signal
AGREE  (or PARTIALLY_AGREE or DISAGREE)
```

Round 1 uses a fuller initial-prompt template (see `templates/initial-prompt.md`).

The orchestrator parses these sections and detects consensus when all (or a threshold of) participants signal `AGREE`.

## Resilience

- **Graduated failure**: 2 consecutive failures → permanent removal; others are notified
- **Catch-up context**: If a session resets mid-discussion, the participant gets a compressed history block before the delta
- **Repair reprompt**: Malformed responses trigger a one-shot correction prompt
- **Tie-breaker**: After 2 stalled rounds, the `lead` participant proposes a synthesis; others vote
- **Quality gate**: Structural pass/warn/fail check on final round (drives exit code and JSON report)
- **Retry with backoff**: Failed turns retried (configurable `maxRetries`, default 1) with exponential delay
- **SIGINT handling**: Ctrl+C flushes current state to `discussion-state.json` before exiting
- **Session isolation**: Claude uses `--resume <sessionId>` to avoid hijacking your active session
- **Temp file security**: Randomised filenames (`randomBytes(8).hex()`) for prompt temp files
- **Path safety**: Output paths are validated against directory traversal attacks
- **Temp cleanup**: `.multi-ai-tmp/` is cleaned up on exit

## Development

```bash
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check without emitting
npm run start -- "topic"  # Run via tsx (dev mode)
npm test               # Run 174 tests
npm run update-models  # Probe installed CLIs and update model names in config
npm run self-review    # Run a self-review discussion (uses topics/self-review.md)
```

## Architecture

```
src/
├── index.ts              # CLI entry point (commander)
├── orchestrator.ts       # Main loop: parallel rounds, retry, consensus, tie-breaker
├── consensus.ts          # Regex parser for structured response sections
├── discussion.ts         # Markdown + JSON file writers, rich footer (TOC, chart, table)
├── prompt-builder.ts     # Template substitution; buildStatelessRoundPrompt for generics
├── process-runner.ts     # Child process spawner with timeout + ANSI stripping
├── quality-gate.ts       # Structural pass/warn/fail evaluation
├── replay.ts             # --replay flag: format and print saved transcripts
├── model-detector.ts     # Probes CLIs to auto-detect available models
├── types.ts              # TypeScript interfaces (DiscussionResult, ParticipantConfig, ...)
└── participants/
    ├── base.ts           # Abstract base class; isStateless(), displayName()
    ├── claude.ts         # Claude Code CLI adapter (JSON output, temp file, resume)
    ├── codex.ts          # OpenAI Codex CLI adapter (exec resume --session)
    ├── gemini.ts         # Gemini CLI adapter (GEMINI_MODEL env var, --resume)
    ├── generic.ts        # Config-driven adapter for any CLI or REST API
    └── index.ts          # Factory: routes type=generic vs built-in IDs

templates/
├── initial-prompt.md             # Round 1 prompt template
├── round-prompt.md               # Round 2+ delta prompt (High-Signal Protocol)
├── tiebreaker-lead-prompt.md     # Tie-breaker lead synthesis prompt
├── tiebreaker-follow-prompt.md   # Tie-breaker follower vote prompt
└── final-summary-prompt.md       # Post-consensus summary prompt

topics/
├── self-review.md        # Self-review discussion topic
└── ollama-session.md     # Ollama session design discussion topic
```

## License

MIT
