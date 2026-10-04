# 00 - Workflow completion routes a red gate through bounded repair

## Problem

`executeWorkflow` is the exercised runtime path (the daemon dispatches it at
`v2/src/daemon/daemon.ts:590`). Its completion block calls
`publishCompletionArtifacts` directly (`v2/src/execution/workflow-runner.ts:821`)
and maps any `ready_gate_failed` straight to a terminal result. The bounded
repair loop `publishWithReadyRepair` (`v2/src/execution/write-loop.ts:877`) is
reachable only from `executeWriteLoop`, which no runtime caller invokes — so
`ready_gate_repair` has never been emitted in production. Existing coverage
(`write-loop.test.ts:861`) exercises repair on the dead path only.

## Decisions

- Route the workflow completion publication through `publishWithReadyRepair` rather than duplicating a second repair loop in the workflow runner; rules out two divergent repair implementations drifting on bound, prompt, and re-commit semantics.
- Build the repair loop's write-loop args from the resolved completion step (`WriteWorkflowStep` is `Omit<WriteLoopInput, "bindings">`) reusing the step's existing binding resolution; rules out inventing a separate agent-binding seam for repair iterations.
- Count repair iterations against the workflow's `totalIterationsConsumed`; rules out a repair loop that escapes the run's iteration budget.
- Keep `ready_flip_failed` outside repair — only a `ReadyGateError` enters the loop; rules out reprompting an agent to fix a GitHub state transition.

## Task checklist

- [x] Export `publishWithReadyRepair` from `v2/src/execution/write-loop.ts`.
- [x] Replace the direct `publishCompletionArtifacts` call in the workflow-runner completion block with the repair-aware publication.
- [x] Thread the store, last write result, and consumed-iteration count into the repair loop; fold its returned count back into `totalIterationsConsumed`.
- [x] Add workflow-runner regression tests for repair-then-green, exhausted repair, and flip-failure-skips-repair.

## Acceptance criteria

- [x] A new `workflow-runner.test.ts` regression test drives `executeWorkflow` to completion with a ready finalizer that raises `ReadyGateError` on its first call and succeeds on the next; the test asserts a `ready_gate_repair` event on the log sink and a `complete` workflow outcome. It fails against the pre-fix code, which emits no repair event.
- [x] A red ready gate that stays red past the repair bound settles `ready_gate_failed`, and the log sink shows exactly `MAX_READY_GATE_REPAIRS` `ready_gate_repair` events — asserted by a new workflow-runner test that fails against the pre-fix code.
- [x] A ready-flip failure (a non-`ReadyGateError` from the ready finalizer) settles `ready_flip_failed` with no `ready_gate_repair` event and no agent reprompt.
- [x] Repair iterations count toward the workflow's reported `iterationsConsumed`.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion-block ordering: commit, publish, gate, bounded repair, republish, settle.
