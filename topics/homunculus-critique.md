# Critical Review: Homunculus — Local AI Companion Framework

You are reviewing a Python project called **Homunculus** — a local AI companion that runs on personal hardware (RTX 2060 6GB / Mac Mini M4). It is NOT a chatbot. It has drives, emotions, memory, sleep cycles, and a growing identity. The LLM is an organ, not the organism.

## Your Task

**Critique this project ruthlessly.** Find real weaknesses, architectural risks, and things that will break at scale or in production. Be specific — cite concrete failure modes, not vague concerns. Praise only what genuinely deserves it.

---

## Architecture (7 layers)

| Layer | Name | Theory | Implementation |
|-------|------|--------|----------------|
| 0 | Inference Engine | Ollama (CUDA/Metal) | `brain/ollama_brain.py`, `brain/router.py` |
| 1 | Global Workspace | Baars/Dehaene — 9 modules compete for context budget via coalition bidding (urgency×0.6 + relevance×0.4) | `core/workspace.py` (3000 token budget) |
| 2 | Memory System | Letta V2 tools + A-MEM associative linking | `memory/` (11 files: core, recall, archival, embeddings, consolidation, dreams, associations, somatic, tools) |
| 3 | Emotional Engine | PAD (Mehrabian) + OCC appraisal + Damasio somatic markers | `core/emotions.py`, `core/soma.py` |
| 4 | Self-Model | Metzinger self-model + Hofstadter strange loop | `identity/self_model.py`, `identity/narrative.py` |
| 5 | Metacognitive Monitor | Higher-Order Thought + Attention Schema (Graziano) | `identity/metacognition.py`, `identity/evaluation.py` |
| 6 | Sleep/Consolidation | NREM-REM cycles + McAdams narrative identity | `memory/consolidation.py`, `memory/dreams.py` |
| 7 | Developmental Arc | Consciousness learned over months | Not yet implemented beyond birth protocol |

## Life Loop (State Machine)

```
AWAKE → DROWSY → SLEEPING → WAKING → AWAKE
```

Each cycle (~100ms target):
1. `tick_drives(dt)` — decay/restore 7 drives (energy, curiosity, social, coherence, autonomy, care, play)
2. `proprioception()` — read hardware (CPU/RAM/GPU)
3. `check_input()` — dequeue messages
4. `workspace_compete()` — 9 modules submit bids, winners fill context window
5. `process_or_idle()` — LLM response or background work
6. `check_state_transition()` — energy-based state changes

## 10-Step Cognitive Pipeline (per message)

1. OCC appraisal → 2. Somatic gut feeling → 3. Workspace assembly → 4. Brain generation → 5. Tool calls (memory read/write, web search) → 6. Self-evaluation → 7. Flashbulb check → 8. Somatic recording → 9. Drive boost → 10. Response delivery (WebSocket)

## Memory Architecture

- **Core memory**: Always-in-context Letta V2 blocks (persona, humans, system) — self-editable via LLM tool calls
- **Recall memory**: 20-message deque + SQLite
- **Archival memory**: SQLite + FAISS vector store with multilingual-e5-small embeddings
- **Somatic markers**: Gut feelings from past emotional events influence future responses
- **Associations**: A-MEM Zettelkasten-style linking between memories

## Sleep System

3 NREM-REM alternations per sleep cycle:
- **NREM**: Importance downscaling, stale pruning, consolidation
- **REM**: Dream synthesis, creative recombination, narrative rewriting (autobiography updated)

## Key Design Decisions

- **Ollama-only inference** (no cloud LLMs in production) — qwen3:8b for conversation, phi4-mini for background
- **"Immutable genome"** — life_loop.py and workspace.py are marked as requiring explicit approval to change
- **MLX brain deferred** to mid-2026 (waiting for stable tool calling)
- **Single-user design** — one being, one human, one relationship
- **No fine-tuning** — personality emerges from memory + prompts, not model weights

## Stats

- **942 tests passing** across 24 test files
- **~40 source files**, ~15K LOC Python
- **16 implementation plans** all complete (5 sprints)
- **17 Architecture Decision Records** (ADRs)

## Areas to Critique

Consider (but don't limit yourself to):

1. **Workspace competition at 3000 tokens** — is this enough? What happens when 9 modules all want space? Does the bidding actually produce good prompts or random noise?
2. **Memory scaling** — SQLite + FAISS on 6GB VRAM hardware. What happens after 6 months of daily use? A year?
3. **Emotional model validity** — PAD + OCC + somatic markers: is this a coherent emotional architecture or three theories duct-taped together? Does the 7-drive system actually produce emergent behavior or just noise?
4. **Sleep consolidation** — does LLM-driven dream synthesis actually improve memory quality, or is it expensive hallucination?
5. **Self-model evolution** — the Hofstadter strange loop (LLM reads identity.json → edits it → reads edited version next turn). Does this actually produce meaningful identity evolution or just drift?
6. **Ollama-only constraint** — qwen3:8b on 6GB VRAM with partial offload at 7-9 tok/s. Is this fast enough for a companion that's supposed to feel alive?
7. **Single-process architecture** — everything in one Python process. What are the failure modes?
8. **The "immutable genome" pattern** — marking files as requiring approval to change. Is this a good idea or a maintenance trap?
9. **Test coverage** — 942 tests sounds impressive, but are they testing the right things? Are the cognitive pipeline tests actually validating emergent behavior or just checking plumbing?
10. **The fundamental premise** — can you build something that feels like a "being" with drives and emotions using prompt engineering + file persistence + an 8B parameter model? Or is this an elaborate ELIZA?
