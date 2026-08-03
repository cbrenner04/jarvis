# Concurrent fan-out sibling dispatch

## Problem

After intent-split admission, sibling fan-out branches dispatch serially (`await` inside branch loops). A later branch can record `failed` with `worktree_claimed` while an earlier sibling's entry run is still live, and serial walks stall peer dispatch.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`runPipeline` suffix walk, `advanceFanOutBranches`). In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-approval.test.ts` fake-store completeness. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: `stageArtifacts` and resolution are branch-scoped.
- Live-linked `running` rows are not terminalized while `workflowInvocationId` names a live entry run (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).

## Decisions

- Fan-out sibling suffix walks in `runPipeline` dispatch concurrently (`Promise.all` or equivalent) — rules out serial `for … await runAuthoredStages` that blocks peer branches on one branch's `wait`.
- `advanceFanOutBranches` dispatches admitted sibling branches concurrently — rules out serial `await runFanOutBranchAction` across branch keys at the first post-split workflow stage.
- Concurrent dispatch preserves entry-run linkage and live-row guards from stage-entry-run-linkage — rules out racing settlement writes that bypass `isLiveEntryRun` / `liveLinkedEntryRunId` checks.
- Cross-branch completion order stays unspecified; correctness does not depend on settle order once artifacts are branch-scoped — rules out serial ordering as a correctness requirement.
- Out of scope: durable `pipeline_stage_admission` claims for duplicate continuations (`pipeline-stage-dispatch-claim` intent).

## Task checklist

- Parallelize `runPipeline` fan-out suffix continuation and `advanceFanOutBranches` branch walks without dropping live-linkage guards.
- Add `pipeline-execution.test.ts` regression: after fan-out admission, both sibling `plan` rows reach `running` without either recording `failed`/`worktree_claimed` while its own linked entry run is still live; serial suffix dispatch makes the test fail.
- Pin `// @mutate` on the concurrent suffix dispatch guard in `runPipeline`.
- Extend `fakeStore` in `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` so every `StateStore` method the concurrent dispatch path calls is implemented (no `undefined` handler surprises).
- Update `v2/docs/daemon-host.md` § Branch fan-out execution and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — two sibling branches from one admitted fan-out both reach `running` without either recording `failed` with `worktree_claimed` while its own entry run is still live; the linked `// @mutate` on concurrent suffix dispatch makes the regression fail against serial baseline.
- [ ] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete with fake stores implementing every `StateStore` method the dispatch path calls.
- [ ] `pipeline-execution.test.ts` — `"live-linked running stage row is not terminalized while its entry run is still live"` and `"fan-out re-entry with deferred-settlement admitted entry run does not terminalize until the run settles"` stay green.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Branch fan-out execution — sibling branches dispatch concurrently; in-memory stage-artifact resolution is branch-scoped.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch concurrency and artifact scoping.
