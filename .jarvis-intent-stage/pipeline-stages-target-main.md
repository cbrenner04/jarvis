---
name: pipeline-stages-target-main
---

# Pipeline plan and implement stages target main

## Primary implementation surface

Daemon

## Problem

Chained pipeline plan and implement stages pin `baseRef` to the prior stage branch (`prior.branch`), producing stacked draft PRs. Operator directive (2026-08-31): standalone and pipeline implement/plan PRs target `main`; the stacked-PR base-pinning behavior is retired.

## Behavior

- Pipeline plan and implement stage resolution sets worktree `baseRef` and draft-PR base to the repository default branch (`main`), not the prior stage branch.
- Chained downstream input resolution (ready-intent, spec path, worktree rematerialization) still reads prior stage artifacts; only git base targeting changes.
- Merge-first retarget workarounds for vanished stacked bases become unnecessary for new runs.

## Decision ledger

- Pipeline plan and implement stages target `main`; rules out `prior.branch` as `baseRef` for chained workflow stages.
- Intent remains the first stage and already targets `main`; rules out re-chaining intent → plan → implement PR stacks.
- Artifact and worktree rematerialization seams stay; rules out folding chained-input resolution into this base-targeting change.
- Retire stacked-PR / merge-first-hazard operator guidance tied to `prior.branch` chaining; rules out documenting both stacked and main-target models concurrently.

## Acceptance criteria

- [ ] A `pipeline-stage-resolve.test.ts` regression drives chained plan and implement stage resolution and asserts each resolved workflow's `baseRef` is the repository default branch, not `prior.branch`; it fails against the current stacked-base pinning.
- [ ] A `pipeline-execution.test.ts` regression drives a multi-stage pipeline through plan and implement publication and asserts each stage's draft PR targets `main`; it fails when implement stacks on the plan branch.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — chained plan/implement stages target `main`; retire stacked-PR base chaining.
- `v2/docs/operator-runbook.md` — remove or replace stacked-PR merge-first-hazard and stacked-stage landing guidance superseded by main targeting.
- `v2/docs/v1-behaviors.md` — record pipeline stage PR base targeting.

## Prerequisites
