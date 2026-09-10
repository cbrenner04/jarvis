---
name: recover-validates-on-disk-plan-stage
---

# `pipeline recover` validates the operator's on-disk staged tree instead of restoring the agent's draft

Unsplit rationale: every behavior below lives in the single plan-stage recovery execution path (`recoverPlanStage` in `v2/src/execution/workflow-runner-resume.ts`), which the daemon recovery orchestrator already calls unchanged; there is no second module-boundary surface to sequence.

## Primary implementation surface

- Plan-stage recovery execution (`v2/src/execution/workflow-runner-resume.ts`)

## Problem

`jarvis pipeline recover` is documented as landing a hand-corrected blocked plan stage without redrafting it — the distinguishing contract against `pipeline resume`. It does not: recover admits, then the stage directory ends up holding the agent's original draft again (fresh mtimes, different byte sizes, `index.md` relinked to both files), and the reported `plan_stage_invalid` failure names a file the operator had deleted before invoking. Evidence: pipeline `443a6cd9`, lane `stamp-gate-commands-on-gate-running-steps`, 2026-09-08 — corrected tree on disk, recover exit `0` `admitted`, stage settled `failed` with `MD012 … (.jarvis-plan-stage/00-daemon.md)`. `.jarvis-plan-stage/` is gitignored and only one run row exists for that branch, so the rewrite happened inside the recover path.

The earlier `stage_resolution_failed: stage "plan" has no preceding workflow artifact` refusal on `full-review` no longer reproduces; recover now admits behind an `approve-intent` gate. Treat that half as closed.

## Behavior

- Recover revalidates the staged tree exactly as it exists on disk at invocation; it never restores, re-materializes, or re-derives stage contents from a durable snapshot.
- Recover invokes no agent role: no write-step dispatch, no new run row, no additional `iteration_started` on the blocked run.
- A validation failure names the file and content actually validated, never a path the operator deleted.
- A structurally invalid on-disk tree (missing `index.md`, unreadable file) refuses before any stage-directory mutation, leaving the operator's tree intact.

## Prerequisites

- `jarvis pipeline recover` admits a blocked plan stage sitting behind an approval gate and settles the row from the attempt outcome.
- Plan-stage recovery revalidates the staged plan contract and runs `lint:md` over `.jarvis-plan-stage` before landing.

## Documentation updates

- `v2/docs/pipeline-execution.md` — recover validates the on-disk staged tree; it neither restores nor redrafts.
- `v2/docs/operator-runbook.md` — the hand-correct-then-recover procedure works; drop the note that `resume` is the only path for a blocked `full-review` plan stage, and record that the prior `stage_resolution_failed` refusal no longer reproduces.
- `v2/docs/v1-behaviors.md` — record the changed recover behavior.
