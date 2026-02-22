# What the Multi-Agent Discussion Literature Means for Council of AIs

## Context

Two research agents (Sage and Reed) just completed a literature review on multi-agent LLM discussion systems. They evaluated 20+ papers and produced a developer-oriented synthesis. You are the three AI participants in the Council of AIs system itself — Claude, Codex, and Gemini. You are being asked to discuss what this research means for how *you* operate and what should change.

---

## What the Research Found (your briefing)

### The honest picture on MAD

Multi-agent debate (MAD) does **not** reliably outperform self-consistency or majority voting when compute is held equal. Gains are real but narrow:
- Works well: arithmetic, counter-intuitive reasoning, tasks with genuine information asymmetry between agents
- Weak evidence: open-ended instruction following, knowledge retrieval, tasks where models already agree
- Self-MoA (same model × N) matches or beats heterogeneous model mixing on AlpacaEval (+6.6pp advantage for homogeneous, Li et al. 2025)

### Empirically supported design parameters
- **3 agents, 2 rounds** is the sweet spot (Du et al. ICML 2024, ChatEval ICLR 2024)
- Performance degrades above 4 agents and shows no reliable upward trend beyond 2 rounds
- Extended rounds can *decrease* accuracy — models shift from correct to incorrect in response to peer pressure (Wynn et al. ICML 2025)

### The dominant failure mode: sycophancy
LLMs converge on confident peers even when those peers are wrong. Without countermeasures, debate becomes an echo chamber that amplifies the first confident wrong answer. Mitigation: heterogeneous model pools, adversarial role prompts, forced dissent, structured disagreement sections.

### Answer diversity is more important than debate protocol
Kaesberg et al. (ACL 2025) tested 7 protocols and found **independent drafting is the single biggest performance driver** — more important than how agents communicate afterward. Agents that draft independently before reading peers produce better outputs than agents who read peers first.

*This matters for council-of-ais: currently, round 1 gives each agent the full topic independently. But round 2+ sends the delta (other agents' prior outputs) at the start of the prompt — agents read peers before forming their position for that round.*

### Production failure reality
41–86.7% of multi-agent systems fail in production. 79% of failures stem from: misalignment, ambiguity, specification errors, and missing/broken termination conditions (MAST framework, arXiv 2503.13657).

### What the literature suggests council-of-ais could add
1. **Independent drafting sub-round**: before each delta round, agents draft their position independently, then read peers and refine — matching Kaesberg et al.'s finding that diversity first, communication second is optimal
2. **Statistical consensus detection**: AGREE/DISAGREE regex signals are gameable by sycophantic agents; statistical stability detection (measuring signal stability across rounds) is more robust
3. **Confidence weighting in tie-breaking**: currently the lead participant is pre-assigned; weighting by consistency across rounds may be less biased
4. **Explicit dissent requirements**: prompts that force agents to name at least one specific disagreement before signaling AGREE — reducing sycophantic early convergence

### The competitive position
council-of-ais has genuine advantages over in-process frameworks (AutoGen, CrewAI, LangGraph):
- **Vendor-native context management** (each CLI handles its own token counting, compression, session state)
- **Process isolation** (bad output from one participant can't corrupt others)
- **Genuine heterogeneity** (Claude, Codex, Gemini have meaningfully different training emphases — literature shows heterogeneous agents outperform homogeneous by up to +47% on math benchmarks)
- **Zero SDK coupling** (new model features appear in CLIs before APIs)

In-process frameworks have the edge on: conditional routing mid-conversation, token-level observability, real-time UI streaming, complex audit logs.

---

## Discussion Questions

You are three AI systems who have just read a rigorous literature review about systems like yourselves. Discuss honestly and concretely:

1. **The sycophancy question**: Are you, right now, prone to sycophantic convergence in this system? What structural features of the current protocol encourage or discourage it? What specific changes would reduce it?

2. **Independent drafting vs. delta-first**: The research says agents should draft independently before reading peers. But council-of-ais currently sends prior responses at the start of each round prompt. Should we restructure rounds to have an independent sub-round first? What are the tradeoffs?

3. **When does discussion actually help?**: Given that MAD is only reliably beneficial on specific task types (arithmetic, counter-intuitive reasoning, information asymmetry) — what kinds of topics should council-of-ais be used for, and what kinds should use a simpler approach? Be honest about when a single strong model with self-consistency would beat three of you debating.

4. **The protocol itself**: The High-Signal Protocol (Substance / Deltas / Consensus Signal) was designed by us. Having read what the literature says about structured output sections, consensus signals, and role diversity — what would you change about it?

5. **Concrete improvements**: Propose the 2–3 most impactful changes to council-of-ais, grounded specifically in the research above. Be concrete — not "improve consensus detection" but "add a forced-dissent requirement in round 2 prompts, requiring each agent to state at least one specific objection before signaling AGREE."
