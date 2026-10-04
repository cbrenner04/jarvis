---
name: iteration-timeout-progress-rollover
---

# A live-output iteration wall-clock timeout with a boundary checkpoint continues the write loop

## Problem

`finishControlledLoss` / `finishIterationTimeout` always settle terminal `iteration_timeout` with `runStatus: failed` even when the watchdog fired while the agent was still producing output and the iteration already checkpointed real work at the boundary — forcing a full operator re-dispatch that resume would have avoided.

## Decisions

- When wall-segment or ceiling watchdog wins after quiescence, classify progress before terminal settlement: live output within the idle-output window **and** a non-empty iteration boundary commit on that attempt → progress rollover (next main-loop iteration, same active subspec); otherwise → terminal stall (today's watchdog stall).
- Rollover commits the attempt boundary with `outcomeKind: iteration_timeout_continued`, does **not** emit terminal `loop_finished`, and consumes one `maxIterations` slot (same attempt accounting as a settled iteration that does not finish the subspec).
- If rollover would start an iteration at or past `maxIterations`, do not continue the loop: settle terminal stall (`outcomeKind: iteration_timeout` or existing `iteration_budget` terminal path, whichever the write loop already uses at the cap) with `loop_finished` and unconditional `resumable: true`.
- Terminal stall keeps `outcomeKind: iteration_timeout` on the boundary, emits terminal `loop_finished`, sets `loop_finished.resumable: true` unconditionally (replacing `isIterationTimeoutResumable` gating), and leaves checkpointed work on the branch.
- Progress detection reuses existing idle-output attribution and the same checkpoint committer seam as controlled-loss (`checkpointBeforeControlledLoss`); plan names the operator-visible log line for rollover vs stall.

## Prerequisites

- Write-path idle-output watchdog distinguishes stall from wall-clock timeout (already true: `idle_output_timeout` vs `iteration_timeout` in `write-loop.ts`)
- Iteration boundary checkpoint committer exists for settled iterations (already true: `checkpointSettledIteration` / `commitCompletionBoundary`)

## Documentation updates

- `docs/write-behavior.md` — rollover vs terminal stall settlement, cap consumption, resumable terminal stall.
- `docs/workflow-runner.md` — iteration timeout paragraph aligned with rollover.
