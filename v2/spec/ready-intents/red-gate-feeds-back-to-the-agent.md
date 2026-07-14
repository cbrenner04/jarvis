---
name: red-gate-feeds-back-to-the-agent
---

# A red ready gate is handed back to the agent for a bounded repair

Today a red ready gate ends the run at `ready_finalize_failed` and the operator hand-fixes the
tree. The gate's command, exit code, and output are never shown to the agent that wrote the code,
even though the failure is usually mechanical (`bun run fix`) and the write loop still has the
worktree open.

## Decisions

- On gate failure the run re-invokes the agent with the gate command, exit code, and output, then re-runs the gate. Rules out today's record-and-stop.
- Repair attempts are capped at 3; a still-red gate after the cap is terminal exactly as today (`ready_finalize_failed`, PR stays draft). Fixed constant, not config or a fraction of the iteration budget — rules out unbounded repair looping and keeps the cap independent of run-to-run iteration budgets.
- Repair iterations are ordinary write-loop iterations: they consume the iteration budget, appear in the run log, and their agent invocations land in telemetry. Rules out hidden off-budget work.
- The feedback is the raw gate output, not a formatting-specific prompt. Which failures are repairable is the agent's problem, not the harness's.

## Out of scope

- The gate's tier or contents.
- v1 patch mode's completion gate.

## Documentation updates

- `v2/docs/write-behavior.md` — the gate boundary and its repair iterations.
- `v2/docs/operator-runbook.md` § Gate trust — drop "hand-fix the tree and push".

## Prerequisites

- The v2 ready gate runs the full tier (format, lint, typecheck, tests) — shipped.
