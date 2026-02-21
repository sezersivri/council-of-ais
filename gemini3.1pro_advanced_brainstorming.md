# Advanced Brainstorming & Next Steps for Council of AIs 

**Date:** 2026-02-21
**Reviewer:** Gemini 3.1 Pro

Now that the core orchestrator is robust, resilient, and well-isolated, here are some advanced ideas to take the `Council of AIs` project to the next level. 

---

## 1. Dynamic Context Reduction (The "Telephone" Protocol)

**The Problem:** Currently, in Round 2+, every AI is fed the *entire* raw text of what the other AIs said in the previous round (`round-prompt.md`). If Claude writes a 1,000-word essay, Codex and Gemini have to read all of it. Over 5 rounds, this context window explodes, leading to higher token costs and slower response times.

**The Idea:** Implement an **Summarizer Step**.
Instead of passing the raw `- rawResponse`, pass only the `- parsedSections.proposal` and `- parsedSections.pointsOfDisagreement` into the next round's prompt. 
If an AI needs to know *why* someone disagreed, they can read the disagreement bullet points. The heavy "Analysis" section is only useful for the human reading the final markdown, not for the AIs negotiating the next delta.

*Implementation:* Modify `buildRoundPrompt` in `src/prompt-builder.ts` to only stringify the `proposal` and `pointsOfDisagreement` arrays for the `{{OTHER_RESPONSES}}` block.

---

## 2. The "Tie-Breaker" Persona (Asymmetric Debates)

**The Problem:** Right now, all 3 AIs hold equal weight (`consensusThreshold`). If Claude and Gemini agree, but Codex stubbornly disagrees because of a niche performance concern, the debate might loop fruitlessly until `maxRounds` is hit.

**The Idea:** Introduce a **Lead Architect** role.
In your `config.json`, allow configuring one participant as the `lead: true`. 
If the debate reaches Round X (e.g., Round 3) without full consensus, the Orchestrator changes the prompt injected into the Lead Architect. It tells the Lead: *"Consensus is failing. As Lead Architect, you must now propose a final compromise that incorporates the best of both sides. You have absolute authority."*
Then, in the following round, the other AIs are prompted: *"The Lead Architect has issued a final proposal. You must AGREE or state a fatal flaw."*

*Implementation:* Add a `isLead?: boolean` to `ParticipantConfig` and introduce a `buildTieBreakerPrompt` in the builder.

---

## 3. Tool-Use Sandbox (Let them code!)

**The Problem:** The AIs are currently just talking. They are proposing API designs or architecture without validating them.

**The Idea:** Give the orchestrator an execution sandbox. 
Since you are using OpenAI Codex and Claude Code (which are natively built for coding), you could add a new section requirement to their prompts:
### Code Artifact
` ```javascript ... ``` `

The orchestrator could parse this `Code Artifact` block, write it to the `.multi-ai-tmp/` directory, and run a quick lint/compile check on it (e.g., `tsc --noEmit`). If the code fails to compile, the orchestrator instantly injects a "System Message" into the next round: *"System Error: Codex's proposed artifact failed to compile with error X. Please revise."*

*Implementation:* Add a regex parser for `Code Artifact` in `consensus.ts`. If populated, `fs.writeFileSync` it, spawn a standard Node child process to test it, and append the result to `userGuidance` for the next round.

---

## 4. Streaming the Debate (UI/UX)

**The Problem:** The user runs the CLI and waits ~30-60 seconds per round staring at `[claude] Thinking...`.

**The Idea:** Stream the CLI outputs directly to the terminal using a multi-pane TUI (Text User Interface) like `blessed` or `ink`. 
Because you are using child processes, you can actually capture the `stdout` streams in real-time. Instead of waiting for the process to exit, you could divide the terminal into 3 vertical columns and render Claude, Codex, and Gemini's responses side-by-side as they type.

*Implementation:* This would require moving away from `runCliProcess` resolving a single string, and instead attaching `data` event listeners to the spawned child process streams.

---

## What's Next?
Which of these directions sounds the most exciting to you? 
*   **Idea 1 & 2** are relatively easy to implement and improve the logic/cost.
*   **Idea 3** makes the AIs actually *build* things together.
*   **Idea 4** makes the orchestrator look incredibly cool to watch.
