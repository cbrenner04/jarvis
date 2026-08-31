# Pipeline resume dispatches after prior worktree removal

## Primary implementation surface

Daemon pipeline resume admission and dispatch in `v2/src/daemon/` (resume path through stage resolution; no separate resume-only resolver).

## Problem

After subspec 00 lands, stage resolution alone is insufficient: `pipeline resume` of a chained plan or implement stage whose prior worktree was removed still refuses pre-dispatch at stage resolution on main today. Operators who cleared a dirty worktree to satisfy the dirty gate remain stranded in-pipeline even when the downstream input lives on the durable prior branch.

## Prerequisites

- Subspec 00 — chained stage resolution durable fallback (including per-workflow read-root rebinding and real-builder absent-worktree tests).

## Decision ledger

- Resume reuses the subspec-00 stage-resolution path; rules out a parallel resume-only downstream-input resolver that could drift from dispatch-time resolution.
- The regression proves admission and dispatch for both chained `plan` and chained `implement` after prior worktree removal; rules out coverage that only exercises `resolveStageWorkflowSteps` in isolation or default stubbed `resolveStage` handlers.

## Tasks

- Confirm `pipeline resume` of a blocked chained plan or implement stage calls the updated stage resolution from subspec 00 without an additional resume gate that still requires the prior worktree directory on disk; fix any resume-only refusal if present.
- Add `pipeline_resume dispatches chained plan and implement stages after prior worktree removal when input lives on durable branch` to `daemon-pipeline-resume.test.ts` with a production-shaped fixture: opt out of the default stubbed `resolveStage`, wire real `resolveStageWorkflowSteps` with `WORKFLOW_PRESET_BUILDERS`, intent and plan stages succeeded with artifacts on durable branches, prior entry-run worktree directories removed, downstream stage blocked at resolution, and `pipeline_resume` admitting dispatch for both chained `plan` and chained `implement` cases (or one test per workflow if the harness requires separate fixtures).
- Assert the blocked downstream stage transitions past resolution to `pending` or `running` (or equivalent dispatch state), not only `{ kind: "resumed" }`.
- Update `v2/docs/operator-runbook.md` per Documentation updates.

## Acceptance criteria

- [x] `daemon-pipeline-resume.test.ts` — `pipeline_resume dispatches chained plan and implement stages after prior worktree removal when input lives on durable branch` uses real `resolveStageWorkflowSteps` and `WORKFLOW_PRESET_BUILDERS` (not the default stubbed `resolveStage`), proves resume admission and dispatch with downstream stages reaching `pending` or `running` after prior worktree removal; it fails against the pre-fix resume refusal at stage resolution (reachable on main: absent prior worktree surfaces `not found in prior worktree` before dispatch and default stubbed `resolveStage` would not exercise the fix).
- [x] `v2/docs/operator-runbook.md` documents that pipeline resume recovers chained inputs from the durable landed artifact and clearing a stage worktree no longer permanently strands resume.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume recovers chained inputs from the durable landed artifact; clearing a stage worktree no longer permanently strands resume.
