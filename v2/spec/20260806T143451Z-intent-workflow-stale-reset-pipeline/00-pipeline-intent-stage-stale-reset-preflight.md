# Pipeline intent-stage stale-reset preflight

## Problem

Pipeline intent-stage dispatch resolves preset steps and calls `start` without
`maybeResetStaleWorkspace` (`daemon-host.md` documents the gap). After failed-stage continuation
(git-enabled intent stage re-dispatch), the daemon reuses the same poisoned worktree/branch/verdict
as a standalone `run workflow intent` re-run; review fails non-retryably with foreign verdict
ownership. Stranded `running` stages with a dead linked run are out of scope — that path returns
`stop` today and does not reach pre-dispatch stale reset.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`advanceWorkflowStage` path before
`dispatchPipelineStage`). In-scope support: `pipeline-execution.test.ts`, durable docs.

## Prerequisites

- `STALE_RESET_WORKFLOWS` includes `"intent"` (`v2/src/commands/stale-reset-workspace.ts`,
  `20260806T135002Z-intent-workflow-stale-reset-cli`).
- Incomplete git-enabled `run workflow intent` re-run retires a poisoned managed worktree via CLI
  preflight before daemon `start` (same spec).
- `maybeResetStaleWorkspace` is importable outside `workflow.ts` (same spec).
- Intent CLI preflight dirty/landed-criteria gate semantics apply via the shared seam; this slice
  passes default inputs (no override flags).

## Decisions

- Run stale-reset preflight on pipeline intent-stage dispatch after stage resolution and before
  worktree materialization / `dispatchPipelineStage` — rules out relying on the CLI
  `runWorkflowCommand` path alone. First qualifying dispatch runs preflight too; no-op when no stale
  managed worktree exists (re-dispatch is the motivating case).
- In-scope: git-enabled intent stage re-dispatch after failed-stage continuation (reopen/resume,
  including daemon-restart continuation). Out-of-scope: stranded `running` stage with dead linked
  run.
- Inject a minimal stale-reset bundle on `PipelineExecutionDeps` (or nested hook): in-process
  `IpcClient` against the same daemon (not loopback), plus `CliDeps`, `Io`, and synthetic intent
  `parsed` inputs `maybeResetStaleWorkspace` expects — rules out undeclared wiring from
  `PipelineExecutionDeps` today.
- Call `maybeResetStaleWorkspace` from `stale-reset-workspace.ts` with default intent inputs (no
  override flags) — intentional daemon→CLI coupling for gate parity with CLI intent re-run; rules
  out ad hoc `resetStaleWorkspace` options.
- Gate on authored stage `workflow: "intent"` plus a git-enabled managed write-step worktree from
  resolution; pass canonical `"intent"` to `maybeResetStaleWorkspace` — rules out resetting no-git
  intent splits and non-intent pipeline stages.
- Linear `advanceWorkflowStage` only — fan-out resolution returns before the insertion point;
  explicitly out of scope.
- Plan/implement pipeline stages omit stale-reset preflight in this slice — rules out broadening to
  all pipeline workflow presets before intent pins the seam.
- Stale-reset refusal maps to stage `failed` via `failureDetail.message` using the same
  operator-facing strings as CLI intent re-run, without calling `dispatchPipelineStage` — rules out
  dispatching into a poisoned tree after a refused reset.
- Deferred to first consumer: how `--reset-despite-dirty` / `--reset-despite-landed-criteria` surface
  on pipeline re-dispatch — pin when a caller needs it.

## Tasks

- [ ] Extend `PipelineExecutionDeps` (or nested hook) with a minimal stale-reset injection bundle
      (`CliDeps`, `Io`, synthetic intent `parsed`, in-process daemon `IpcClient`).
- [ ] After successful single-stage resolution in `advanceWorkflowStage`, when authored
      `workflow: "intent"` and the resolved write step has a git-enabled managed worktree, call
      `maybeResetStaleWorkspace` with canonical `"intent"` before `dispatchPipelineStage`.
- [ ] On stale-reset refusal, record stage `failed` via `failureDetail.message` with the same
      operator-facing strings as CLI intent re-run; do not dispatch.
- [ ] Add `pipeline-execution.test.ts` —
      `"pipeline intent-stage re-dispatch resets a poisoned worktree before the write step"`: borrow
      `materializeStaleWorktree` / git helpers from `workflow.test.ts`, intent resolution patterns
      from `pipeline-stage-resolve.test.ts`, and the failed-continuation drive from
      `"re-dispatches only the failed continuation stage"`; git fixture, materialize managed intent
      worktree, seed stale `.jarvis-intent-review-verdict.md` and foreign-`invocationId`
      `.jarvis-intent-review-verdict.md.owner`, drive failed-stage pipeline continuation/re-dispatch
      with production intent resolution and real stale-reset subprocess effects; assert worktree
      absent from `git worktree list` and verdict sidecars gone at the dispatch boundary (dispatch
      callback observes clean slate; worktree recreation is downstream of `start`, not asserted
      synchronously); fails against pre-fix code.
- [ ] Add `// @mutate` on that test targeting the intent-stage stale-reset guard (stable unique
      condition or call site in `pipeline-execution.ts`); applying the mutation turns the regression
      RED.
- [ ] Add `pipeline-execution.test.ts` —
      `"pipeline intent-stage stale-reset refusal fails stage without dispatch"`: seed a guard
      refusal (e.g. dirty tracked file), drive failed-stage continuation/re-dispatch, assert stage
      `failed` with CLI-matching refusal message and `dispatchPipelineStage` not called; fails
      against pre-fix code.
- [ ] Add `// @mutate` on the refusal test targeting the refusal branch (stable unique condition in
      `pipeline-execution.ts`); applying the mutation turns the refusal regression RED.
- [ ] Update `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md` § Recovery, and
      `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"pipeline intent-stage re-dispatch resets a poisoned worktree
      before the write step"` seeds stale `.jarvis-intent-review-verdict.md` on a managed
      intent-stage worktree, re-dispatches via failed-stage continuation, asserts worktree absent
      from `git worktree list` and verdict sidecars gone at the dispatch boundary, and fails against
      pre-fix code.
- [ ] Mutation checkpoint: the affirmative regression in `pipeline-execution.test.ts` carries a
      `// @mutate` directive that skips intent-stage stale-reset preflight; applying it turns the
      regression above RED.
- [ ] `pipeline-execution.test.ts` — `"pipeline intent-stage stale-reset refusal fails stage without
      dispatch"` seeds a guard refusal (e.g. dirty tracked file), asserts stage `failed` with
      CLI-matching refusal message and dispatch not called, and fails against pre-fix code.
- [ ] Mutation checkpoint: the refusal regression in `pipeline-execution.test.ts` carries a
      `// @mutate` directive on the refusal branch; applying it turns the refusal regression RED.
- [ ] `workflow.test.ts` — `"run workflow intent resets a stale worktree before daemon start"` stays
      green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — add pipeline intent-stage re-dispatch stale-reset beside existing CLI
  `run workflow intent` prose; revise the deferred-vs-CLI gap prose that currently limits stale reset
  to CLI `plan`/`implement`; retain documented deferrals for `prepareWorkflowSteps` (iteration
  bounds, review timeouts) — this slice closes stale-reset only.
- `v2/docs/operator-runbook.md` § Recovery — add pipeline intent-stage re-dispatch auto-clears
  poisoned intent verdict trees when guards pass; retain `jarvis cleanup --abandon` for refused-guard
  and non-pipeline cases (not a global drop).
- `v2/docs/v1-behaviors.md` — record pipeline intent-stage stale reset on re-dispatch (git-enabled
  managed worktree only; shared `maybeResetStaleWorkspace` gates; no pipeline override flags in this
  slice).
