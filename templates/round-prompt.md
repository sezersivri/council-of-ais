Round {{ROUND_NUMBER}} of {{MAX_ROUNDS}}.

{{USER_GUIDANCE}}What the other participants said last round:

{{OTHER_RESPONSES}}

---

Respond now. Use EXACTLY these three sections:

### Substance
{{CONVERGENCE_INSTRUCTION}}Your updated position and plan. Only describe what changed and why — do not restate others' positions.

### Deltas
Bullet list of position changes (max 3):
- `+adopted: [point] from @[agent]` — you adopted their idea
- `-reject: [point] because [reason]` — you disagree
- `~modified: [point] — [how it changed]`

Write `None` if your position is unchanged.

### Consensus Signal
`AGREE_WITH_RESERVATION: [≥20 words naming a specific concern or failure mode]`
`PARTIALLY_AGREE`
`DISAGREE`

Rules: No fluff. No restating others' arguments. Max 3 bullets in Deltas.
If you agree, you MUST use `AGREE_WITH_RESERVATION` with ≥20 words naming a specific concern.
Bare `AGREE` is accepted only for backward compatibility.
