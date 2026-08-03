# Stage dispatch live linkage and settlement mirroring

## Problem

`dispatchPipelineStage` can terminalize a stage while its admitted entry run is still live, and non-success settlement can record generic `harness_failure` / `nextAction: "stop"` even when the owning run carries a mappable operator error (e.g. `completion_commit_failed` / `resume` with `loop_finished` terminal log context).

## Surface

Primary: `v2/src/daemon/pipeline-stage-dispatch.ts`. In-scope: `pipeline-stage-dispatch.test.ts`, `run-operator-error.ts` only as needed for settlement mirroring. Execution premature terminalization is subspec 01.

## Decisions

- `workflowInvocationId` on the stage row is the admitted entry run id for the entire live window — rules out persisting workflow snapshot `invocationId` or a superseded/completed run id.
- After admission, the stage row stays `running` with that linkage until the entry run settles — rules out writing any terminal patch while the linked run is still live.
- Non-success settlement loads the settled entry run's terminal log context (`findTerminalLogRecord` or equivalent) and copies the full `composeRunOperatorError` result (`reason`, `retryable`, `nextAction`, and optional detail fields) onto `failureDetail` — rules out generic `harness_failure` / `stop` when the run carries operator detail.
- Pre-run dispatch refusal (`ok: false`) still records immediate `failed` with `{ code, message }` and never writes `workflowInvocationId` — rules out leaving the stage `pending` or inventing linkage.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Task checklist

- Hold the stage at `running` with `workflowInvocationId` set to the admitted entry run id until settlement; do not terminalize while that run is live.
- On non-success settlement, load terminal log context from the settled entry run and build `failureDetail` from `composeRunOperatorError(entryRun, terminalRecord)` (not a minimal stub run).
- Port linkage/settlement regressions from PR #2555 (`pipeline-stage-dispatch.test.ts` only — **exclude** `v2/spec/20260803T002657Z-fan-out-stage-dispatch-preserves-workflow-ownership/`):
  - `records workflowInvocationId before the wait primitive resolves`
  - `pre-run dispatch refusal leaves the stage failed and unlinked`
  - `post-admission linkage-write failure preserves the live entry run and settles after recovery`
  - `post-admission wait rejection preserves the live entry run and settles after recovery`
- Add a new mirroring regression: settled entry run with `failed` status and `loop_finished` / `completion_commit_failed` terminal log context; assert `failureDetail` matches full `composeRunOperatorError` output (`reason: "completion_commit_failed"`, `nextAction: "resume"`, `retryable: true`), not `harness_failure` / `stop`.
- Pin `// @mutate` directives (each target text occurs exactly once in the named file):
  - Live window: `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "const rollupStatus = await wait(dispatched.entryRunId);" -> "store.updateStage({ ...stageTarget, patch: { status: \"failed\", endedAt: Date.now() } }); const rollupStatus = await wait(dispatched.entryRunId);"`
  - Mirroring: `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "composeRunOperatorError(entryRun, terminalRecord)" -> "composeRunOperatorError(entryRun)"`
- Update `v2/docs/daemon-host.md` § Pipeline stage dispatch for linkage identity and failure mirroring.

## Acceptance criteria

- [x] `pipeline-stage-dispatch.test.ts` — after admission, a still-live entry run leaves the stage `running` with `workflowInvocationId` equal to that entry run id until settlement; the live-window `// @mutate` directive above makes the regression fail against baseline.
- [x] `pipeline-stage-dispatch.test.ts` — non-success settlement on a settled entry run with `loop_finished` / `completion_commit_failed` terminal log context records the full composed operator error (`reason: "completion_commit_failed"`, `nextAction: "resume"`, `retryable: true`), not `harness_failure` / `stop`; the mirroring `// @mutate` directive above makes the regression fail against baseline.
- [x] `pipeline-stage-dispatch.test.ts` — pre-run dispatch refusal (`worktree_claimed`) records `failed` with no `workflowInvocationId` ever written.
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — `workflowInvocationId` is the admitted entry run id; live-window `running` invariant; non-success `failureDetail` mirrors `composeRunOperatorError` from the settled entry run with terminal log context.
