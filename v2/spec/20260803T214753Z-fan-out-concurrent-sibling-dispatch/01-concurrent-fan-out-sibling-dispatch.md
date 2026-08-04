# Concurrent fan-out sibling dispatch

## Problem

After linear fan-out admission (intent completes with `downstreamInputs`, sibling branches admit at the first post-split workflow stage), sibling `plan` rows dispatch serially (`await` inside branch loops). A later branch can record `failed` with `worktree_claimed` naming another stage's invocation while its own linked entry run is still live, and serial walks stall peer dispatch.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`runPipeline` suffix walk, `advanceFanOutBranches`). In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-approval.test.ts` store/double completeness. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: `stageArtifacts` and resolution are branch-scoped.
- Live-linked `running` rows are not terminalized while `workflowInvocationId` names a live entry run (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).

## Decisions

- Fan-out sibling suffix walks in `runPipeline` dispatch concurrently (`Promise.all` or equivalent) — rules out serial `for … await runAuthoredStages` that blocks peer branches on one branch's `wait`.
- `advanceFanOutBranches` dispatches admitted sibling branches concurrently — rules out serial `await runFanOutBranchAction` across branch keys at the first post-split workflow stage.
- Primary `worktree_claimed` false-positive regression uses linear fan-out (`FAN_OUT_LINEAR_DEFINITION`: intent → plan per branch, no approval gate) — rules out gated intent→approval→plan as the core fixture.
- Concurrent dispatch preserves entry-run linkage and live-row guards from stage-entry-run-linkage — rules out racing settlement writes that bypass `isLiveEntryRun` / `liveLinkedEntryRunId` checks.
- Cross-branch completion order stays unspecified; correctness does not depend on settle order once artifacts are branch-scoped — rules out serial ordering as a correctness requirement.
- Out of scope: durable `pipeline_stage_admission` claims for duplicate continuations (`pipeline-stage-dispatch-claim` intent); recovery/restart branch walks (`recoverContinuablePipelines`, `resumePipeline`) may remain serial — this spec covers initial dispatch and in-flight continuation from `runPipeline` suffix walks and `advanceFanOutBranches` only.

## Task checklist

- Parallelize `runPipeline` fan-out suffix continuation and `advanceFanOutBranches` branch walks without dropping live-linkage guards.
- Add `pipeline-execution.test.ts` regression `"linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive"`: `FAN_OUT_LINEAR_DEFINITION` fixture; deferred `wait` on one branch's plan entry run; `flushBackgroundRuns` mid-pipeline; assert the sibling branch's plan row is `running` (or appears in dispatch log) before the deferred branch settles; neither branch records `failed` with `worktree_claimed` naming another stage's invocation while its own linked entry run is still live.
- Add `pipeline-execution.test.ts` suffix regression `"linear fan-out sibling suffix stages dispatch concurrently"`: both branches past the split; deferred `wait` on one branch's implement entry run; `flushBackgroundRuns`; assert the sibling implement row is `running` before the deferred branch settles.
- Pin `// @mutate` on concurrent dispatch in `advanceFanOutBranches` (serial `for … await runFanOutBranchAction`); the plan-dispatch regression above must go RED.
- Pin `// @mutate` on concurrent suffix dispatch in `runPipeline` (serial `for … await runAuthoredStages` across branch keys); the suffix regression above must go RED.
- Ensure every `StateStore` method the concurrent dispatch path invokes is implemented in test doubles used by `pipeline-execution.test.ts` (`fakeStore`) and in the real store exercised by `daemon-pipeline-approval.test.ts` (`openStateStore`); no new fan-out scenarios required in approval tests — existing cases need only complete without `undefined` handler surprises after parallelization.
- Update `v2/docs/daemon-host.md` § Branch fan-out execution: sibling branches dispatch concurrently; **in-memory** stage-artifact resolution is branch-scoped `(stageId, branchKey)`. Replace any serial-dispatch description.
- Update `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch concurrency and in-memory artifact scoping.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive"` (deferred `wait` on one branch, `flushBackgroundRuns` before settle, sibling plan `running` first) fails against serial `advanceFanOutBranches`; linked `// @mutate` on concurrent branch dispatch makes the regression fail.
- [ ] `pipeline-execution.test.ts` — `"linear fan-out sibling suffix stages dispatch concurrently"` fails against serial suffix `runAuthoredStages`; linked `// @mutate` on concurrent suffix dispatch makes the regression fail.
- [x] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete without `StateStore` method gaps on the concurrent dispatch path (fake doubles in execution tests; real SQL store in approval tests).
- [x] `pipeline-execution.test.ts` — `"live-linked running stage row is not terminalized while its entry run is still live"` and `"fan-out re-entry with deferred-settlement admitted entry run does not terminalize until the run settles"` stay green.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Branch fan-out execution — sibling branches dispatch concurrently; in-memory stage-artifact resolution is branch-scoped `(stageId, branchKey)`.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch concurrency and in-memory artifact scoping.

## Blocker

The two mutation-checkpoint criteria above are **unticked because their directives are inert**, verified
by applying each by hand against the merged code:

```text
"const outcomes = await Promise.all(fanOutBranchDispatchTasks);"
  -> "const outcomes = []; for (const task of fanOutBranchDispatchTasks) { outcomes.push(await task); }"
"await Promise.all(suffixBranchWalkTasks);"
  -> "for (const task of suffixBranchWalkTasks) { await task; }"
```

Both leave `pipeline-execution.test.ts` at **73 pass / 0 fail**. The task arrays are built with
`.map()`, which starts every promise eagerly, so awaiting them serially changes nothing — the
concurrency has already happened by the time the directive's loop runs. The other two directives in
this spec (branch-scoped lookup, suffix shared-map guard) were verified to kill correctly.

Making these pins real needs the dispatch tasks to be **lazy thunks** (`.map(… => async () => …)`)
with the concurrency in the awaiting line. That change was prototyped and works, but the serialized
form then *deadlocks* the fixture instead of failing it: alpha blocks on its deferred `wait`, beta
never dispatches, and the pipeline promise never settles. Since mutation verification has no timeout
and is not wired to the run's abort signal, a hanging directive would stall the write step
indefinitely — worse than an inert one. Wrapping the assertions in `try/finally` to release the
deferred wait did not clear the hang.

So the remaining work is a test-design change, not a one-line fix: the fan-out fixtures need a
bounded wait so that serialized dispatch **fails fast**. Do that before re-ticking these two.

The production concurrency itself is not in doubt — `advanceFanOutBranches` and the `runPipeline`
suffix walk do dispatch concurrently, and both regressions pass against them.
