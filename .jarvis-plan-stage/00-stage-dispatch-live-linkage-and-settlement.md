# Stage dispatch live linkage and settlement mirroring

## Problem

`dispatchPipelineStage` can terminalize a stage while its admitted entry run is still live, and non-success settlement can record generic `harness_failure` / `nextAction: "stop"` even when the owning run carries a mappable operator error (e.g. `completion_commit_failed` / `resume`).

## Surface

Primary: `v2/src/daemon/pipeline-stage-dispatch.ts`. In-scope: `pipeline-stage-dispatch.test.ts`, `run-operator-error.ts` only as needed for settlement mirroring.

## Decisions

- `workflowInvocationId` on the stage row is the admitted entry run id for the entire live window — rules out persisting workflow snapshot `invocationId` or a superseded/completed run id.
- After admission, the stage row stays `running` with that linkage until the entry run settles — rules out writing any terminal patch while the linked run is still live.
- Non-success settlement copies the owning entry run's composed operator error (`reason`, `retryable`, `nextAction`, and optional detail fields) onto `failureDetail` — rules out generic `harness_failure` / `stop` when `composeRunOperatorError` can map the run.
- Pre-run dispatch refusal (`ok: false`) still records immediate `failed` with `{ code, message }` and never writes `workflowInvocationId` — rules out leaving the stage `pending` or inventing linkage.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Task checklist

- Hold the stage at `running` with `workflowInvocationId` set to the admitted entry run id until settlement; do not terminalize while that run is live.
- On non-success settlement, build `failureDetail` from `composeRunOperatorError` with the entry run's terminal log context.
- Add `pipeline-stage-dispatch.test.ts` regressions for the live window and operator-error mirroring with `// @mutate` checkpoints on the real guards.
- Update `v2/docs/daemon-host.md` § Pipeline stage dispatch for linkage identity and failure mirroring.

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` — after admission, a still-live entry run leaves the stage `running` with `workflowInvocationId` equal to that entry run id until settlement; a `// @mutate` on the live guard makes the regression fail against baseline.
- [ ] `pipeline-stage-dispatch.test.ts` — non-success settlement records the owning entry run's operator `reason` and `nextAction` (cover `completion_commit_failed` / `resume`, not `harness_failure` / `stop`); a `// @mutate` on the mirroring guard makes the regression fail against baseline.
- [ ] `pipeline-stage-dispatch.test.ts` — `"a dispatch refusal records failed and failureDetail immediately with no linkage ever written"` stays green.
- [ ] `bun run typecheck` exits zero.
- [ ] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` — `workflowInvocationId` is the admitted entry run id; live-window `running` invariant; non-success `failureDetail` mirrors `composeRunOperatorError` from the entry run.
