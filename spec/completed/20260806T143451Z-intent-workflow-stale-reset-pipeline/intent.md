---
name: intent-workflow-stale-reset-pipeline
---

# Pipeline intent stage stale reset on re-dispatch

## Problem

Pipeline intent-stage dispatch resolves preset steps and calls `start` without `maybeResetStaleWorkspace` (`daemon-host.md` documents the gap). A killed intent stage leaves the same poisoned worktree/branch/verdict as standalone `run workflow intent`; pipeline re-dispatch reuses it and review fails non-retryably with foreign verdict ownership.

## Decisions

- Run stale-reset preflight on pipeline intent-stage re-dispatch before worktree materialization and
  `dispatchPipelineStage` — rules out relying on the CLI `runWorkflowCommand` path alone.
- Call the shared `maybeResetStaleWorkspace` seam from intent 1 — rules out ad hoc
  `resetStaleWorkspace` options that diverge from CLI gates.
- Apply only when the resolved intent stage is git-enabled with a managed worktree — rules out
  resetting no-git intent splits.
- Deferred to first consumer: how `--reset-despite-dirty` / `--reset-despite-landed-criteria`
  surface on pipeline re-dispatch — pin when a caller needs it.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"pipeline intent-stage re-dispatch resets a poisoned worktree
      before the write step"` seeds stale `.jarvis-intent-review-verdict.md` on a managed intent-stage
      worktree, re-dispatches the pipeline intent stage, asserts retirement before the write step
      (worktree removed and recreated, verdict gone), and fails against pre-fix code.
- [ ] Mutation checkpoint: `pipeline-execution.test.ts` carries a `// @mutate` directive that skips
      intent-stage stale-reset preflight; applying it turns the regression above RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline intent-stage re-dispatch runs the same stale-reset preflight
  as CLI `run workflow intent`.
- `v2/docs/operator-runbook.md` § Recovery — a killed intent no longer strands a verdict marker;
  drop manual `jarvis cleanup --abandon` as the recovery path for this case.
- `v2/docs/v1-behaviors.md` — record pipeline intent-stage stale reset.

## Prerequisites

- `STALE_RESET_WORKFLOWS` includes `"intent"`.
- Incomplete git-enabled `run workflow intent` re-run retires a poisoned managed worktree (stale `.jarvis-intent-review-verdict.md` included) via CLI preflight before the write step.
- Stale-reset preflight is callable from non-CLI workflow entry points.
