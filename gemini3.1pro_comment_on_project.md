# Code Review: Council of AIs (`multi-ai`)

**Date:** 2026-02-21
**Reviewer:** Gemini 3.1 Pro

## 1. Project Overview & Strengths
The `Council of AIs` orchestrator is a highly creative and well-executed project. The concept of structuring debates between different AI CLIs (Claude Code, OpenAI Codex, and Google Gemini) to reach a consensus is brilliant. 

The architecture is robust and thoughtfully designed. The application relies on spawning and communicating with external CLI processes rather than consuming APIs directly. This effectively utilizes the local session management built into these tools.

**Key Strengths:**
*   **Parallel Execution:** In `src/orchestrator.ts`, the implementation of concurrent execution using `Promise.allSettled` to spawn the AI CLIs simultaneously is excellent. This drastically reduces the total duration of each round compared to sequential execution.
*   **Polymorphic Participant Design:** `src/participants/base.ts` establishes a solid foundation for the participant logic. Creating specific implementations (`claude.ts`, `codex.ts`, `gemini.ts`) cleanly abstracts away the varied complexities of each CLI (e.g., Codex preferring temporary files over stdin, Gemini reading from stdin natively).
*   **State & Resilience Management:** The orchestrator implements exponential backoff for retries and manages graceful degradation effectively. If a participant drops out, the system continues and notifies the others, mimicking a real-world debate drop-out.
*   **Session Management Strategy:** By relying on flags like `claude --resume` or `codex exec resume --last`, the orchestrator remains stateless regarding conversation history. This avoids the overhead of passing massive context windows back and forth, offloading that responsibility entirely to the underlying tools.

---

## 2. Areas for Improvement & Potential Vulnerabilities

While the foundational architecture is solid, there are specific areas where the code could be made more resilient, particularly in terms of parsing edge cases and managing state leakage.

### A. Parsing Brittleness (`src/consensus.ts`)

The regex patterns used in `parseResponseSections` are heavily dependent on exact matches of Markdown headers (specifically `###`). 

```typescript
const analysisMatch = rawResponse.match(/###\s*Analysis\s*\n([\s\S]*?)(?=###|$)/i);
```

**Issue:** 
LLMs are highly variable in their output formatting. If an LLM decides to format the section using an `H2` (`## Analysis`), a bolded string (`**Analysis**:`), or omits the line break immediately after the header, the regex will fail to match, resulting in an empty section string being captured.

**Recommendation:**
Loosen the regular expressions to accommodate variations in heading levels and Markdown styling (like bolding). 
*Example:* `/(?:^|\n)#*\s*\**Analysis\**:?\s*\n([\s\S]*?)(?=(?:\n#*\s*\**[A-Z][a-z]+)|\Z)/` (Note: Writing a robust regex for this is notoriously difficult, so an alternative approach could be fuzzy section searching, or using structured JSON outputs exclusively if the LLMs can be forced into it).

### B. Session Cross-Talk & State Leakage (`codex.ts` & `gemini.ts`)

`claude.ts` correctly captures and re-uses a specific `session_id` returned from the JSON output. However, the implementations for Codex and Gemini rely on "latest" flags.

*   `codex.ts`: Uses `['exec', 'resume', '--last']`
*   `gemini.ts`: Uses `['--resume', 'latest']`

**Issue:**
This introduces a severe race condition for session mixups. If a user runs two instances of the `Council of AIs` orchestrator concurrently, or if they happen to use the Codex/Gemini CLI in another terminal window mid-debate, `--last` and `latest` will point to the *wrong* session. Information from an entirely different conversation will leak into the debate.

**Recommendation:**
Investigate if the underlying Codex and Gemini CLIs expose explicit, unique session IDs (similar to Claude's `--resume <sessionId>`). If they do, parse these from the initial responses and hardcode them into the `buildContinueCommand` arrays to guarantee execution isolation.

### C. JSON Line Parsing Vulnerability (`codex.ts` & `gemini.ts`)

Both `codex.ts` and `gemini.ts` use a similar approach to extract output: they split `stdout` by newlines and try to `JSON.parse()` every individual line to find the CLI's metadata wrapper.

```typescript
// codex.ts snippet
const jsonLines = lines.filter((line) => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
});
```

**Issue:**
If the LLM's response itself contains valid JSON strings on a single line (which is very common, especially if discussing code or API payloads), `JSON.parse` will succeed on those lines. The script might then attempt to read `.type === 'message'` or `.text` from the user's generated JSON payload rather than the CLI wrapper, leading to undefined results or crashing.

**Recommendation:**
Implement stricter validation beyond `JSON.parse(line)`. Verify the shape of the parsed object:
```typescript
try {
  const parsed = JSON.parse(line);
  if (parsed && typeof parsed === 'object' && 'session_id' in parsed) {
     return true;
  }
  return false;
}
```

### D. Missing Pre-flight Dependency Checks

The orchestrator assumes that `claude`, `codex`, and `gemini` are globally available in the user's `PATH` and fully authenticated.

**Issue:**
If an executable is missing or an API key has expired, the script discovers this deep inside the `runCliProcess` execution stack. The child process exits with `ENOENT` or a runtime failure, requiring the orchestrator to wait for a timeout or process an ugly stderr block.

**Recommendation:**
Implement a pre-flight verification step in `index.ts` or at the start of `orchestrate.ts`. Use a lightweight `process-runner` call (e.g., `[CLI_NAME] --version`) for each required participant before the debate begins. Fail fast and loudly if dependencies are missing, providing clear installation/authentication instructions.

---

## Conclusion
The project is structurally sound, highly innovative, and achieves its goals beautifully. The recommended architectural changes primarily focus on hardening the text parsing and isolating session state to prevent edge-case collisions.
