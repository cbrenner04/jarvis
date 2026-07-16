---
name: red-ready-gate-enters-repair-before-settlement
---

# A red ready gate enters repair before settlement

The shipped bounded repair loop has never emitted `ready_gate_repair`; a genuinely
red branch instead reached a terminal result reported as completed. Status-only
tests do not prove the repair path ran.

Route a red ready gate through the bounded agent repair loop before any terminal
settlement. A red gate cannot produce `runStatus: "completed"`; regression coverage
must observe `ready_gate_repair` on the exercised runtime path.

## Decisions

- Define `completed` to require a green ready gate; rules out publishing a red branch as terminal success for the operator to discover later.
- Route every red ready gate to repair before terminal settlement and assert the `ready_gate_repair` event; rules out status-only coverage that passes while repair is dead code.
- Keep ready-flip failures outside gate repair; rules out asking an agent to repair a GitHub state transition.

## Documentation updates

- `v2/docs/workflow-runner.md` — gate, repair, republish, and settlement ordering.
- `v2/docs/write-behavior.md` — green-gate completion boundary and repair evidence.
- `v2/docs/operator-runbook.md` — gate trust, verified repair behavior, and removal of obsolete red-gate guidance.
- `v2/docs/v1-behaviors.md` — record the changed v2 completion guarantee.

## Prerequisites

- Ready-gate and ready-flip failures are distinct in terminal logs and `run list`.
- A failed ready flip terminal-settles the workflow and releases its claim.
