---
name: repair-red-gate-before-workflow-completion
---

# Repair a red gate before workflow completion

Implement-workflow publication bypasses the write loop's ready-gate repair path. A red gate can
therefore leave the durable workflow `completed`, emit no `ready_gate_repair`, and return the same
success status as a green gate.

## Decisions

- Route workflow `ready_gate_failed` through the existing bounded repair loop before terminal settle; rules out workflow finalization calling the publish-and-finalize helper without repair orchestration.
- Permit durable `completed` only after a green gate; rules out treating a completion commit or published draft PR as sufficient success evidence.
- If repair blocks, exhausts its iteration budget or attempt cap, or leaves the gate red, report `runStatus: "failed"` with `ready_gate_failed`; rules out preserving `runStatus: "completed"` beside a red-gate outcome.
- Keep exhausted red-gate failure resumable and leave the PR draft; rules out discarding the existing operator recovery path or exposing unverified code as ready.
- Do not repair `ready_flip_failed`; rules out asking the coding agent to fix GitHub publication state.
- Prove the composed implement-workflow path emits `ready_gate_repair` and cannot return `completed` while red; rules out coverage that exercises only an injected write-loop seam.

## Scope

- Cover red-then-green repair, persistently red exhaustion, and flip failure through workflow execution plus daemon `wait` and `run list` reporting.
- Keep the existing repair cap, prompt payload, budget accounting, and gate contents unchanged.
- Do not change biome rules.

## Documentation updates

- `v2/docs/workflow-runner.md` — repair-before-settle ordering and terminal outcomes.
- `v2/docs/operator-runbook.md` — trust `completed` only after the composed repair path is verified; remove the manual re-gate caveat only with that evidence.
- `v2/docs/v1-behaviors.md` — record the corrected v2 completion invariant and workflow repair composition.

## Prerequisites

- Ready-gate, ready-flip, and earlier publication failures surface as distinct workflow outcomes and operator error reasons.
