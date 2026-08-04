# Concurrent fan-out sibling dispatch

## Problem

After linear fan-out admission (intent completes with `downstreamInputs`, sibling branches admit at the first post-split workflow stage), sibling `plan` rows dispatch serially (`await` inside branch loops). A later branch can record `failed` with `worktree_claimed` naming another stage's invocation while its own linked entry run is still live, and serial walks stall peer dispatch.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`runPipeline` suffix walk, `advanceFanOutBranches`). In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-approval.test.ts` store/double completeness. Depends on subspec 00.

## Prior art — read before implementing

A first implementation of this subspec was closed unmerged (PR #2577); its branch
`20260803T214753Z-fan-out-concurrent-sibling-dispatch` is retained on origin. It introduced a
leader/peer scheme — `fanOutDispatchLeaderKey`, `awaitFanOutPeerRow`, `advanceFanOutPendingPeersAtStage`
— roughly 140 lines of coordination this subspec never asked for, with three separate places able to
dispatch a peer branch. `awaitFanOutPeerRow` spun on `await Promise.resolve()`, which starved the
event loop (5M iterations in 114 ms with a `setTimeout(…, 0)` that never fired) and hung
`pipeline-end-to-end` roughly one run in three.

**Do not carry that design forward.** The Decisions above exist because of it. Two pieces from that
branch are known good and worth salvaging: subspec 00's branch-scoped artifacts (both mutation pins
verified to kill), and commit `d402961c0`, which latches the `daemon-pipeline-resume.test.ts` binding
double — that double silently drops a `settle()` arriving before the binding is invoked, and the
latch is worth taking regardless of how this subspec is implemented.

Prefer the simplest thing that satisfies the Decisions: if a branch never needs to wait on a peer at
all — each branch resolving and dispatching its own row, as `main` did before the leader scheme —
that is a valid and preferable answer.

## Prerequisites

- Subspec 00 landed: `stageArtifacts` and resolution are branch-scoped.
- Live-linked `running` rows are not terminalized while `workflowInvocationId` names a live entry run (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).

## Decisions

- Fan-out sibling suffix walks in `runPipeline` dispatch concurrently (`Promise.all` or equivalent) — rules out serial `for … await runAuthoredStages` that blocks peer branches on one branch's `wait`.
- `advanceFanOutBranches` dispatches admitted sibling branches concurrently — rules out serial `await runFanOutBranchAction` across branch keys at the first post-split workflow stage.
- Primary `worktree_claimed` false-positive regression uses linear fan-out (`FAN_OUT_LINEAR_DEFINITION`: intent → plan per branch, no approval gate) — rules out gated intent→approval→plan as the core fixture.
- Concurrent dispatch preserves entry-run linkage and live-row guards from stage-entry-run-linkage — rules out racing settlement writes that bypass `isLiveEntryRun` / `liveLinkedEntryRunId` checks.
- Cross-branch completion order stays unspecified; correctness does not depend on settle order once artifacts are branch-scoped — rules out serial ordering as a correctness requirement.
- **No branch may busy-wait on a peer.** A branch that cannot proceed until a peer's row advances must suspend on a signal the dispatching side resolves. `await Promise.resolve()` in a loop is specifically forbidden: it yields to microtasks only, so the queue never drains and timers and I/O never run — rules out starving the event loop and wedging the daemon at 100% CPU.
- **Peer dispatch responsibility is total.** For every state of the dispatching branch's row at the fan-out stage — `pending`, `running`, `succeeded`, `failed`, `skipped` — a still-`pending` peer either gets dispatched or its stage settles with a named failure — rules out a peer waiting forever because the dispatcher moved on or terminated.
- **Every cross-branch wait is bounded** and settles a named, operator-visible failure on expiry — rules out an unbounded wait that reads as a hung pipeline with no diagnosis.
- **Exactly one settler per stage row.** A given `(stageId, branchKey)` row is awaited and terminally patched by one code path only — rules out the dispatcher and the peer's own walk both awaiting the same `wait(entryRunId)` and writing competing terminal patches.
- **Sibling failures are aggregated, not first-rejection**, and no branch walk keeps writing stage rows after the pipeline settles terminal publication — rules out `Promise.all` swallowing a second sibling rejection and leaving a detached walk running past settlement.
- **The concurrency seam is one invertible expression.** Dispatch tasks are lazy thunks whose concurrency lives in the awaiting line, so serializing that single line genuinely serializes dispatch — rules out an eager `.map()` that starts every promise before the awaiting line and makes the mutation directives inert.
- Out of scope: durable `pipeline_stage_admission` claims for duplicate continuations (`pipeline-stage-dispatch-claim` intent). Recovery/restart branch walks (`recoverContinuablePipelines`, `resumePipeline`) may remain serial, **but must not deadlock**: restart recovery re-enters `continuePipeline` with no `continuationBranchKey`, and that path is covered by the total-responsibility decision above.

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

- [x] `pipeline-execution.test.ts` — `"linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive"` (deferred `wait` on one branch, `flushBackgroundRuns` before settle, sibling plan `running` first) fails against serial `advanceFanOutBranches`; linked `// @mutate` on concurrent branch dispatch makes the regression fail. Applying that directive by hand must make the suite **fail**, not hang.
- [x] `pipeline-execution.test.ts` — `"linear fan-out sibling suffix stages dispatch concurrently"` fails against serial suffix `runAuthoredStages`; linked `// @mutate` on concurrent suffix dispatch makes the regression fail. Applying that directive by hand must make the suite **fail**, not hang.
- [x] `pipeline-execution.test.ts` proves a still-`pending` peer is dispatched (or settles a named failure) when the dispatching branch's fan-out row is already `succeeded`, and again when it is `failed` and when it is `skipped`; each case fails against a dispatcher that returns without dispatching the peer.
- [ ] `pipeline-execution.test.ts` proves a cross-branch wait yields to the macrotask queue — a `setTimeout(…, 0)` armed before the wait fires while a peer is still pending — and that the wait is bounded, settling a named failure rather than hanging when the peer never advances.
- [x] `pipeline-execution.test.ts` proves exactly one terminal `updateStage` write per peer `(stageId, branchKey)` row when its entry run is **live** at dispatch time (not seeded terminal, which lets `isLiveEntryRun` mask a second settler).
- [x] `pipeline-execution.test.ts` proves two sibling walks failing in the same pipeline both surface their failures, and that no stage row is written after `settlePipelineTerminalPublication` has settled the pipeline.
- [x] `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` passes **8 consecutive runs** of the whole file; a single green run does not satisfy this criterion.
- [x] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete without `StateStore` method gaps on the concurrent dispatch path (fake doubles in execution tests; real SQL store in approval tests).
- [x] `pipeline-execution.test.ts` — `"live-linked running stage row is not terminalized while its entry run is still live"` and `"fan-out re-entry with deferred-settlement admitted entry run does not terminalize until the run settles"` stay green.
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Branch fan-out execution — sibling branches dispatch concurrently; in-memory stage-artifact resolution is branch-scoped `(stageId, branchKey)`.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch concurrency and in-memory artifact scoping.
