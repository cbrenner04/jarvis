---
name: recover-plan-stage-from-own-durable-row
---

# Recover a plan stage from its own durable row

Unsplit rationale: The fix changes one module-boundary surface: daemon recovery-target resolution; dispatch resolution and the recovery execution loop retain their existing contracts.

## Prerequisites

- Admitted plan-stage recovery follows the failed plan row's `workflowInvocationId` to its persisted entry-run record, then validates and lands that run's populated on-disk `.jarvis-plan-stage/` without invoking a plan writer, reviewer, or actuator.
- Plan-stage dispatch resolves its ready-intent from the preceding workflow artifact and refuses when that artifact is absent.

## Primary implementation surface

- Daemon pipeline-stage recovery target resolution (`v2/src/daemon/pipeline-stage-recovery.ts`)

## Problem

`pipeline recover` reuses the dispatch-oriented stage resolver, so a failed plan stage with a correct staged tree refuses `stage_resolution_failed` when its predecessor artifact is unavailable. Recovery already has the failed row's linked entry run and does not dispatch the plan workflow, making that predecessor requirement irrelevant and forcing a wasteful redraft through `pipeline resume`.

## Behavior

`pipeline recover` resolves a failed plan target from its own durable row: the row's `workflowInvocationId`, the corresponding persisted entry-run record, that run's recorded worktree, and its staged tree. It admits recovery even when the predecessor artifact is absent. Plan dispatch continues to require the predecessor artifact.

## Decisions

- Derive recovery identity and location from the failed plan row's `workflowInvocationId` and its linked persisted entry-run record; do not call the general dispatch resolver.
- Preserve recovery refusals for a non-failed or non-plan target, a missing row-to-entry-run linkage, an existing claim, or a missing staged tree.
- Preserve direct validation and landing of the staged bytes with no plan write, review, or actuator invocation.
- Leave `pipeline resume` and general stage resolution unchanged; missing predecessor artifacts still refuse plan dispatch with the existing `pipeline-stage-resolve:` diagnostic.

## Acceptance criteria

- [ ] A new `pipeline-stage-recovery.test.ts` regression proves `recover` admits a failed plan stage with a present staged tree and absent predecessor artifact; it fails against the pre-fix `stage_resolution_failed` refusal.
- [ ] `pipeline-stage-resolve.test.ts` — `downstream input never landed anywhere durable refuses with distinct named reason pointing at standalone re-drive` stays green: the same absent predecessor artifact still refuses plan-stage dispatch with the existing `pipeline-stage-resolve:` message.
- [ ] `pipeline-stage-recovery.test.ts` — `refuses an unrecoverable stage target with a named reason` stays green for a target that is not a failed plan stage or lacks its row-to-entry-run linkage.
- [ ] `pipeline-stage-recovery.test.ts` — `recovery refuses a stage whose admission claim is held` stays green, and `workflow-runner-resume.test.ts` — `refuses review-failed recovery for ineligible write, staging, blocker, live-claim, and review-sibling shapes` stays green for a missing staged tree.
- [ ] `workflow-runner-resume.test.ts` — `recovers an operator-edited plan stage through publication without redrafting` proves the staged tree lands exactly as it sits on disk without invoking a plan write step, reviewer, or actuator.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — recovery target resolution from the failed row versus predecessor-dependent dispatch resolution.
- `v2/docs/operator-runbook.md` — remove predecessor resolution from `pipeline recover` preconditions.
- `v2/docs/v1-behaviors.md` — record the narrowed recovery resolution path.
