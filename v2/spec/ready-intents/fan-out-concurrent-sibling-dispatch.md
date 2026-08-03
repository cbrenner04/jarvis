---
name: fan-out-concurrent-sibling-dispatch
---

# Fan-out sibling branches dispatch concurrently with branch-scoped artifacts

## Problem

After intent-split approval, sibling `plan` branches dispatch serially on `await wait()`, and all branches share one `stageArtifacts` map keyed only by `stageId`. A branch can resolve its next stage from a sibling's artifact depending on settle order.

Prior art: PR #2555 — keep `chainedInputRoot` ready-intent read-path changes; do not re-derive disproven ownership predicates (`destinationDistinctFromPredecessor`, `selectChainedStageCwd`, `PriorArtifactContext.cwd`).

## Decisions

- Fan-out sibling branches dispatch concurrently instead of serializing on `await wait()` — rules out sequential branch walks that stall peer dispatch.
- In-memory `stageArtifacts` is keyed by `(stageId, branchKey)` — rules out a single `stageId` map shared across branches.
- Each branch builds and reads only its own artifact map when resolving downstream stages — rules out `sharedStageArtifacts` carry-forward across fan-out suffix walks.
- Concurrent dispatch does not relax entry-run linkage from the prior intent — rules out racing settlement writes that bypass live-run guards.
- Out of scope: durable stage-admission claims for duplicate continuations (next intent).

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` proves two sibling branches from one approved fan-out both reach `running` without either recording `failed` with `worktree_claimed` naming another stage's invocation while its own entry run is still live; the regression fails against baseline serial dispatch.
- [ ] `pipeline-stage-resolve.test.ts` proves a branch resolving its next stage never reads a sibling's artifact when branches settle in a controlled order; the regression fails against baseline single-key maps.
- [ ] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete with fake stores implementing every `StateStore` method the dispatch path calls.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — concurrent fan-out branch dispatch and branch-scoped stage-artifact resolution.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch and artifact scoping.

## Prerequisites

- A stage with an admitted entry run stays `running` until that run settles and is never `failed` while the run is live.
- Stage failure records the owning run's operator error and `nextAction`; `workflowInvocationId` names the entry run.
