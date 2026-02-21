# Council of AIs

An orchestrator that makes **Claude Code CLI**, **OpenAI Codex CLI**, and **Google Gemini CLI** hold structured debates. Each AI takes turns responding to a topic in a structured format, and the orchestrator detects when they reach consensus.

## How It Works

```
You: "Design a REST API for a task management app"

         ┌─────────┐   ┌─────────┐   ┌─────────┐
         │  Claude  │   │  Codex  │   │ Gemini  │
         └────┬─────┘   └────┬────┘   └────┬────┘
              │              │              │
  Round 1     ├──────────────┼──────────────┤  (parallel, all think at once)
              │              │              │
              ▼              ▼              ▼
         ┌─────────────────────────────────────┐
         │  Orchestrator collects responses,   │
         │  detects consensus signals           │
         └──────────────────┬──────────────────┘
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
                   Final Summary Document
```

Key design choices:
- **Session-persistent**: Each CLI is called once per round. Between rounds, session continuation flags (`claude --resume`, `codex exec resume --last`, `gemini --resume latest`) maintain conversation context natively.
- **Delta-only prompts**: Only what the *other* AIs said last round is sent — not the full history.
- **Parallel execution**: All participants run concurrently each round (~3x faster than sequential).
- **Graceful degradation**: If one CLI fails/times out, the others continue.

## Prerequisites

You need at least **two** of these CLIs installed and authenticated:

| CLI | Install | Auth |
|-----|---------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | `claude` (follow prompts) |
| [OpenAI Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | `export OPENAI_API_KEY=...` |
| [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @anthropic-ai/gemini-cli` | `gemini` (follow prompts) |

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

# Interactive mode: pause between rounds to steer the discussion
npx tsx src/index.ts "Design a microservices architecture" --watch

# Verbose: see exact CLI commands being run
npx tsx src/index.ts "Best practices for error handling" --verbose

# Custom output file
npx tsx src/index.ts "Database schema design" --output my-discussion.md
```

### CLI Options

```
Usage: multi-ai <topic> [options]

Arguments:
  topic                         The topic or question for the AIs to discuss

Options:
  -r, --rounds <number>         Maximum discussion rounds (default: 5)
  -p, --participants <list>     Comma-separated: claude,codex,gemini (default: all three)
  -o, --output <file>           Output markdown filename (default: discussion.md)
  -c, --config <path>           Path to custom config JSON
  -w, --watch                   Interactive mode — pause between rounds for user input
  -v, --verbose                 Show CLI commands and stderr
  -V, --version                 Show version
  -h, --help                    Show help
```

### Interactive Mode (`--watch`)

Between each round, you can:
- Press **Enter** to continue normally
- Type **s** to stop the discussion early
- Type **any text** to inject guidance into the next round (e.g., "focus more on security concerns")

## Output

Each run produces two files in `./output/`:

| File | Contents |
|------|----------|
| `discussion.md` | Full markdown transcript of the discussion with all responses |
| `discussion-state.json` | Machine-readable state with session IDs, consensus status, and timing metadata |

After each round, a summary table is printed:

```
  ┌───────────┬──────────────────┬─────────┐
  │ claude    │ AGREE            │  45.2s  │
  │ codex     │ PARTIALLY_AGREE  │  32.1s  │
  │ gemini    │ AGREE            │  28.8s  │
  └───────────┴──────────────────┴─────────┘
```

## Configuration

Copy `config.default.json` to customize:

```bash
cp config.default.json config.json
npx tsx src/index.ts "topic" --config config.json
```

```jsonc
{
  "maxRounds": 5,
  "consensusThreshold": 1,        // 1.0 = all must AGREE, 0.66 = two-thirds
  "participants": [
    {
      "id": "claude",
      "enabled": true,
      "cliPath": "claude",         // path to CLI binary
      "timeoutMs": 120000,         // 2 min timeout per turn
      "maxRetries": 1,             // retry once on failure
      "role": "Security Architect", // optional persona (forces diverse perspectives)
      "model": "opus",             // optional model override
      "extraArgs": []              // extra CLI flags
    }
    // ... codex, gemini
  ]
}
```

### Persona Roles

Without roles, three general-purpose LLMs tend to converge quickly on "safe" answers. Assigning roles forces multi-dimensional analysis:

```json
{
  "id": "claude",  "role": "Security Architect"
},
{
  "id": "codex",   "role": "Performance Engineer"
},
{
  "id": "gemini",  "role": "Developer Experience Advocate"
}
```

## Discussion Protocol

Each AI must structure every response with these exact sections:

1. **Analysis** — Substantive analysis of the topic
2. **Points of Agreement** — What they agree with from others
3. **Points of Disagreement** — What they disagree with and why
4. **Proposal** — Concrete, actionable plan
5. **Consensus Signal** — One of: `AGREE`, `PARTIALLY_AGREE`, `DISAGREE`

The orchestrator parses these sections and detects consensus when all (or a threshold of) participants signal `AGREE`.

## Resilience

- **Retry with backoff**: Failed turns are retried (configurable `maxRetries`, default 1) with exponential delay (2s, 4s, ...)
- **Graceful degradation**: If a participant fails all retries, others continue and are informed of the dropout
- **SIGINT handling**: Ctrl+C flushes the current state to `discussion-state.json` before exiting
- **Session isolation**: Claude uses `--resume <sessionId>` to avoid hijacking the user's active Claude Code session
- **Temp cleanup**: `.multi-ai-tmp/` is cleaned up on exit

## Development

```bash
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check without emitting
npm run start -- "topic"  # Run via tsx (dev mode)
```

## Architecture

```
src/
├── index.ts              # CLI entry point (commander)
├── orchestrator.ts       # Main loop: parallel rounds, retry, consensus detection
├── consensus.ts          # Regex parser for structured response sections
├── discussion.ts         # Markdown + JSON file writers
├── prompt-builder.ts     # Template substitution for prompts
├── process-runner.ts     # Child process spawner with timeout
├── types.ts              # TypeScript interfaces
└── participants/
    ├── base.ts           # Abstract base class (buildCommand, parseOutput)
    ├── claude.ts         # Claude Code CLI adapter
    ├── codex.ts          # OpenAI Codex CLI adapter
    ├── gemini.ts         # Gemini CLI adapter
    └── index.ts          # Factory function

templates/
├── initial-prompt.md         # Round 1 prompt template
├── round-prompt.md           # Round 2+ delta prompt template
└── final-summary-prompt.md   # Post-consensus summary prompt
```

## License

MIT
