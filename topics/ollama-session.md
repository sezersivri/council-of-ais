You are discussing a specific design problem in **multi-ai** — a Node.js/TypeScript orchestrator that makes AI CLIs (Claude, Codex, Gemini) debate until consensus. You are being run by that same tool right now.

## What was just implemented (Phase 3 — GenericParticipant)

`src/participants/generic.ts` — a new `GenericParticipant` class that lets any CLI tool join discussions via config:

```json
{
  "id": "ollama-llama",
  "type": "generic",
  "cliPath": "ollama",
  "extraArgs": ["run", "llama3"],
  "inputMode": "stdin",
  "enabled": true,
  "timeoutMs": 60000
}
```

`ParticipantId` was widened from `'claude'|'codex'|'gemini'` to `string`. The factory in `src/participants/index.ts` routes `type: 'generic'` to `GenericParticipant`.

### Stateless vs Stateful (current design)

`GenericParticipant.isStateless()` returns `!config.session`. When stateless, the orchestrator calls `buildStatelessRoundPrompt()` every round, which injects:

```
## Full Discussion Context
**Topic:** {original topic}
**Round:** N of M
**Consensus Status:** {emerging|partial|full|disagreement}
**Discussion History:**
  Round 1: CLAUDE: ... | CODEX: ... | GEMINI: ...
  Round 2: ...
---
{standard delta prompt — what others said last round}
```

The opt-in `session` config block looks like:

```typescript
interface GenericSessionConfig {
  extractPattern: string;    // regex with 1 capture group → string session ID
  continueArgs: string[];    // appended on continue; {sessionId} is substituted
}
```

Example for a hypothetical tool that returns a UUID session:
```json
"session": {
  "extractPattern": "session_id: (\\S+)",
  "continueArgs": ["--session", "{sessionId}"]
}
```

### The Ollama Problem

`ollama run llama3` (CLI) is fully stateless between subprocess invocations — no session concept at all. Stateless mode works fine for this.

However, **Ollama's REST API** (`POST http://localhost:11434/api/generate`) has a `context` field:
- The response includes `"context": [1234, 5678, ...]` — an array of token IDs representing the conversation so far
- If you pass this `context` array back in the next request body, the model continues the conversation with full native memory (no prompt stuffing needed)
- This is more efficient and more accurate than stateless context injection for long discussions

The **mismatch**: our current `session` config only handles a *string* session ID. Ollama's context is a *JSON integer array* that must be embedded inside the next request body — not appended as a CLI arg.

A curl-based generic participant for Ollama REST would look like:
```json
{
  "id": "ollama-api",
  "type": "generic",
  "cliPath": "curl",
  "extraArgs": ["-s", "-X", "POST", "http://localhost:11434/api/generate",
                "-H", "Content-Type: application/json", "--data-binary", "@-"],
  "inputMode": "stdin",
  "jsonField": "response"
}
```

But there is no way to pass the `context` array back into the next request body with the current `session` design, because `{sessionId}` substitution only works for string args, not for JSON body construction.

## The Design Question

**What is the right way to add Ollama session memory to GenericParticipant?**

Consider the full solution space:
1. **Wrapper script approach** — a user-provided shell/Python script manages context persistence; `GenericParticipant` stays simple. The script accepts a prompt on stdin, reads context from a temp file, calls the Ollama API, writes new context back to the file, returns the response.
2. **Body template approach** — extend `GenericSessionConfig` to support `bodyTemplate` (a JSON string with `{prompt}` and `{sessionState}` placeholders) and `sessionStateField` (JSONPath/field name to extract from the response). The orchestrator builds the request body by substitution.
3. **HTTP participant type** — add a separate `type: 'http'` participant that natively handles JSON request/response cycles, supports arbitrary body construction, and stores complex session state (arrays/objects) between rounds.
4. **Session file approach** — for stateful generics, the orchestrator writes extracted session state to a temp file and makes the path available as `{sessionFile}`; the subprocess reads and writes it. Supports arbitrary formats.
5. **Something else** — e.g., make `GenericParticipant` able to invoke a user-provided JS/TS module as a session adapter.

## Constraints
- No new npm runtime dependencies (project has only `commander`)
- Must work for Ollama REST API (`/api/generate` with `context` array) as the primary use case
- Should generalize to other tools that return complex session state (not just Ollama)
- Must not break the existing stateless default or the simple string-ID session mechanism
- Implementation complexity must be proportional to benefit — don't over-engineer

## Your Task
Discuss, debate, and converge on the best design. Be concrete: specify the config schema, the data flow, and which files change. The final plan should be implementable without further design decisions.
