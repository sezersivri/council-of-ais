# Agent Souls — Architecture Review & Improvement Discussion

## What This Project Is

**Agent Souls** (repo: `my-agents`) is a persistent identity, knowledge, and memory system for AI agent teams — built entirely on Markdown files and Git. No databases, no runtimes, no external dependencies.

The core insight: most AI coding agents forget everything between sessions. Agent Souls gives each agent a persistent `CORE.md` (identity), `cheatsheets/` (distilled domain knowledge), and `memory/` (session logs, mistakes, decisions) — all version-controlled plain text files.

### Team Structure

17 agents across 6 domains:
- **Aerospace**: Miles (Aerodynamicist Lead, Opus), Nash (CFD Engineer, Sonnet)
- **Software Dev**: Max (Architect Lead, Opus), Sam (Backend, Sonnet), Lena (Frontend, Sonnet), Kit (QA, Haiku), Dash (DevOps, Sonnet), Ward (Security, Sonnet)
- **Research**: Sage (Analyst, Sonnet), Reed (Technical Writer, Haiku)
- **Game Dev**: Drake (Game Designer Lead, Opus), Cody (Game Developer, Sonnet)
- **iOS Dev**: Logan (iOS Lead, Opus), Maya (iOS Developer, Sonnet)
- **Financial**: Blake (Market Strategist Lead, Opus), Kai (Quant Analyst, Sonnet), Finn (Risk Manager, Sonnet)

### Key Architecture Pieces

```
agents/
├── manifest.json                # Single source of truth for all agents
└── {domain}/{agent}/
    ├── CORE.md                  # Identity, hard rules, personality, expertise
    ├── cheatsheets/             # Distilled domain knowledge (progressive disclosure)
    │   └── _index.md            # Index of available cheatsheets
    └── memory/
        ├── session-log.md       # What happened each session
        ├── mistakes.md          # Errors made + root causes (read at every startup)
        └── decisions.md         # Key technical decisions + rationale

shared-knowledge/
├── active-tasks.md              # Real-time cross-agent coordination
├── cross-agent-learnings.md     # Domain-spanning knowledge
├── global-mistakes.md           # Mistakes that affect all agents
├── project-registry.md          # Projects this team has worked on
└── team-conventions.md          # Shared coding/process conventions

.claude/agents/          # Native Claude Code auto-discovered wrappers
.agents/skills/          # Cross-tool skill files (Gemini, Codex)
templates/               # CORE-TEMPLATE.md, cheatsheet-template.md, etc.
scripts/
├── generate-tool-configs.py     # Generates .claude/agents/ and .agents/skills/ from manifest.json
├── validate.py                  # Validates manifest, file existence, schema consistency
└── load-agent.sh / .ps1         # Shell scripts to load an agent's context
```

### Cross-Tool Compatibility

| Tool | Integration | How |
|------|-------------|-----|
| Claude Code | Native `.claude/agents/` | Auto-discovered, `/summon`, `/session-end`, `/learn` |
| Gemini CLI | `AGENTS.md` context file | `.agents/skills/{agent}/SKILL.md` |
| Codex CLI | `AGENTS.md` auto-read | `.agents/skills/{agent}/SKILL.md` |
| Cursor | `.cursorrules` | Direct `CORE.md` paths |
| Windsurf | `.windsurfrules` | Direct `CORE.md` paths |

### Session Protocol (Mandatory)

Every session end: update session-log.md → record mistakes → record decisions → update cheatsheets → update shared-knowledge → optional git commit.

Every session start: read GENERAL_RULES.md → read CORE.md → check mistakes.md → scan cheatsheets/_index.md → load relevant cheatsheets only.

### Custom Commands (Claude Code)

- `/summon <agent>` — Load an agent's full context and identity
- `/session-end` — Execute the mandatory Session End Protocol
- `/learn <source>` — Study source material, distill into cheatsheets

### Current Roadmap

1. Knowledge Seeding — Populate cheatsheets through real usage
2. Multi-repo Support — Submodule overlay system for cross-project agents
3. v1.0 Stable — Stabilize manifest schema, session-end protocol, cross-tool packaging

---

## Questions for Discussion

You are three expert AI systems reviewing this project. Please give a thorough, honest critique and concrete improvement proposals. Cover:

1. **System design strengths and weaknesses** — What does the file-based, Git-native approach do well? Where does it break down at scale (many agents, many sessions, large cheatsheets)?

2. **The memory system** — Is the current 3-file memory structure (session-log, mistakes, decisions) the right abstraction? What's missing? How should pruning and archiving work at scale?

3. **Cross-tool compatibility** — The project supports Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf. Is maintaining parallel skill files (`.claude/agents/` + `.agents/skills/`) sustainable? What's the ideal single-source-of-truth approach?

4. **The cheatsheet / progressive disclosure model** — Is "distill into cheatsheets first, load on demand" the right knowledge model? What are the failure modes?

5. **Agent collaboration** — Currently agents share knowledge through `shared-knowledge/` files. Is this sufficient? What's missing for real multi-agent coordination?

6. **The manifest.json approach** — Using a single JSON manifest as the source of truth, then generating tool configs from it. Is this the right build-system approach? What breaks first?

7. **Concrete improvements** — What are the top 3-5 specific features or structural changes that would make Agent Souls significantly more powerful or usable?

8. **Risks and failure modes** — What could go wrong with this system as it scales? What assumptions are baked in that may not hold?
