# Pipeline intent-stage stale-reset preflight

## Problem

Pipeline intent-stage dispatch resolves preset steps and calls `start` without
`maybeResetStaleWorkspace` (`daemon-host.md` documents the gap). A killed intent stage leaves the
same poisoned worktree/branch/verdict as standalone `run workflow intent`; pipeline re-dispatch
reuses it and review fails non-retryably with foreign verdict ownership.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`advanceWorkflowStage` path before
`dispatchPipelineStage`). In-scope support: `pipeline-execution.test.ts`, durable docs.

## Prerequisites

- `STALE_RESET_WORKFLOWS` includes `"intent"` (`v2/src/commands/stale-reset-workspace.ts`,
  `20260806T135002Z-intent-workflow-stale-reset-cli`).
- Incomplete git-enabled `run workflow intent` re-run retires a poisoned managed worktree via CLI
  preflight before daemon `start` (same spec).
- `maybeResetStaleWorkspace` is importable outside `workflow.ts` (same spec).

## Decisions

- Run stale-reset preflight on pipeline intent-stage re-dispatch after stage resolution and before
  worktree materialization / `dispatchPipelineStage` — rules out relying on the CLI
  `runWorkflowCommand` path alone.
- Call the shared `maybeResetStaleWorkspace` seam with default intent inputs (no override flags) —
  rules out ad hoc `resetStaleWorkspace` options that diverge from CLI gates.
- Gate on the authored stage `workflow: "intent"` (and `intent-reviewed` when it resolves to intent)
  plus a git-enabled managed write-step worktree from resolution — rules out resetting no-git intent
  splits and non-intent pipeline stages.
- Plan/implement pipeline stages omit stale-reset preflight in this slice — rules out broadening to
  all pipeline workflow presets before intent pins the seam.
- Stale-reset refusal fails the stage (`failed` + operator-facing detail) without calling
  `dispatchPipelineStage` — rules out dispatching into a poisoned tree after a refused reset.
- Deferred to first consumer: how `--reset-despite-dirty` / `--reset-despite-landed-criteria` surface
  on pipeline re-dispatch — pin when a caller needs it.

## Tasks

- [ ] After successful single-stage resolution in `advanceWorkflowStage`, when the authored workflow
      is intent-shaped and the resolved write step has a git-enabled managed worktree, call
      `maybeResetStaleWorkspace` with a daemon-connected `IpcClient` before `dispatchPipelineStage`.
- [ ] On stale-reset refusal, record stage `failed` with the same operator-facing refusal surfaces as
      CLI intent re-run; do not dispatch.
- [ ] Add `pipeline-execution.test.ts` —
      `"pipeline intent-stage re-dispatch resets a poisoned worktree before the write step"`: git
      fixture, materialize managed intent worktree, seed stale `.jarvis-intent-review-verdict.md` and
      foreign-`invocationId` `.jarvis-intent-review-verdict.md.owner`, drive failed-stage pipeline
      continuation/re-dispatch with production intent resolution and real stale-reset subprocess
      effects; assert worktree absent and verdict sidecars gone before the dispatch callback observes
      materialization (then dispatch proceeds); fails against pre-fix code.
- [ ] Add `// @mutate` on that test targeting the intent-stage stale-reset guard (stable unique
      condition or call site in `pipeline-execution.ts`); applying the mutation turns the regression
      RED.
- [ ] Update `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md` § Recovery, and
      `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"pipeline intent-stage re-dispatch resets a poisoned worktree
      before the write step"` seeds stale `.jarvis-intent-review-verdict.md` on a managed
      intent-stage worktree, re-dispatches the pipeline intent stage, asserts retirement before the
      write step (worktree removed and recreated, verdict gone), and fails against pre-fix code.
- [ ] Mutation checkpoint: the regression test in `pipeline-execution.test.ts` carries a `// @mutate`
      directive that skips intent-stage stale-reset preflight; applying it turns the regression above
      RED.
- [ ] `workflow.test.ts` — `"run workflow intent resets a stale worktree before daemon start"` stays
      green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline intent-stage re-dispatch runs the same stale-reset preflight as
  CLI `run workflow intent`; revise the deferred-vs-CLI gap prose that currently limits stale reset
  to CLI `plan`/`implement`.
- `v2/docs/operator-runbook.md` § Recovery — pipeline intent-stage re-dispatch clears a poisoned
  intent verdict tree automatically; drop `jarvis cleanup --abandon` as the recovery path for a
  killed pipeline intent stage when guards pass (retain `--abandon` for refused-guard and
  non-pipeline cases).
- `v2/docs/v1-behaviors.md` — record pipeline intent-stage stale reset on re-dispatch (git-enabled
  managed worktree only; shared `maybeResetStaleWorkspace` gates; no pipeline override flags in this
  slice).
