# Settlement liveness, deferred detail, and re-settlement mirroring

## Problem

`applyEntryRunSettlement` writes `failed` and `endedAt` on any non-`completed` rollup without re-checking `isLiveEntryRun`. After daemon restart, `adoptAndSettlePipelineStage` can call `wait` through a primitive that mirrors `waitForWorkflowEntryRun` rollup semantics (no in-flight workflow promise; rollup from durable non-terminal entry-run state), which resolves a non-`completed` rollup without awaiting — terminalizing a still-live entry run. A premature non-success settlement on a live entry run also records `harness_failure` / `stop` because `composeRunOperatorError` is undefined for non-terminal runs; when the entry run later terminals, settlement must mirror the composed operator error on the terminal patch.

## Surface

Primary: `v2/src/daemon/pipeline-stage-dispatch.ts` (`applyEntryRunSettlement`, `settlePipelineStageFromEntryRun`, `adoptAndSettlePipelineStage`). In-scope: `pipeline-stage-dispatch.test.ts`, `daemon.ts` `waitForWorkflowEntryRun` rollup semantics only as the mirror-primitive contract for adopt-path tests (no source repair in this subspec).

## Decisions

- Repair at settlement: `applyEntryRunSettlement` re-checks `isLiveEntryRun(store, entryRunId)` immediately before writing any non-`completed` terminal patch and declines to terminalize when the entry run is still live — rules out fixing `waitForWorkflowEntryRun` at its source in this slice.
- Declined non-success settlement leaves the stage `running` without `endedAt` and records `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live", entryRunId, rollupStatus }` until a later settlement attempt succeeds or the entry run actually settles — rules out a silent `running` row with no operator-visible signal in `pipeline list`.
- Re-settlement is driven by existing adopt/continue/recovery paths when the linked entry run is no longer live: `continuePipeline`, `adoptRunningWorkflowStage`, refused-admission adopt, and `pipeline_resume` each re-invoke adopt/settlement (`adoptAndSettlePipelineStage` / `settlePipelineStageFromEntryRun`) — rules out deferred `running` forever with no named retry seam.
- `pipeline list` surfaces `failureDetail` on `running` stage rows as stored (deferred detail is operator-visible without terminalizing).
- `paused`, `budget-soft-stopped`, and any other non-terminal durable entry-run status are live (`isLiveEntryRun`); declined settlement applies the same as `in-progress` — rules out terminalizing a non-terminal entry run from a premature non-`completed` rollup.
- Success (`rollupStatus === "completed"`) settlement is unchanged: still terminalizes even when the entry run row reads live until the success patch lands.
- After deferred settlement, when the entry run is terminal and settlement is not deferred, non-success `failureDetail` mirrors `composeRunOperatorError` from terminal log context (e.g. `completion_commit_failed` / `resume`) — rules out `harness_failure` / `stop` on the eventual terminal patch.
- Adopt-path test contract: exercise adopt/settlement through a `wait` primitive that mirrors `waitForWorkflowEntryRun` rollup semantics (no in-flight promise; durable non-terminal entry run) — not a stub that unconditionally returns `failed` while the store still shows live; not a literal `waitForWorkflowEntryRun` integration subspec.
- Out of scope: `derivePipelineState` terminality, `waitForWorkflowEntryRun` source contract change, base-ref retarget, `failWorkflowStageAt` guard deletion, concurrent sibling dispatch.

## Task checklist

- In `applyEntryRunSettlement`, before the non-`completed` terminal `updateStage`, return early when `isLiveEntryRun(store, entryRunId)`; write the deferred `failureDetail` shape on the `running` row (no `endedAt`, no `status` change away from `running`).
- Add `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `wait` returns a non-`completed` rollup while `store.loadRun(entryRunId)` remains non-terminal; assert stage stays `running` without `endedAt` and `failureDetail` matches the deferred shape; pin `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (isLiveEntryRun(store, entryRunId)) {" -> "if (false) {"` on the liveness guard inserted immediately before the non-`completed` terminal `updateStage`.
- Add `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"`: exercise `adoptAndSettlePipelineStage` through a `wait` primitive that mirrors `waitForWorkflowEntryRun` rollup semantics (no in-flight workflow promise; rollup from durable non-terminal entry-run state).
- Assert no stage patch sets `status` to `failed` or `succeeded` while the linked entry run is live (`isLiveEntryRun`) — cover in the live-decline tests.
- Add `pipeline-stage-dispatch.test.ts` — `"deferred settlement re-settles with operator error when entry run later terminals"`: first settlement deferred over live entry run with non-`completed` rollup; entry run transitions to terminal `failed` with `completion_commit_failed` / `resume` log context; second adopt/settlement asserts terminal `failed` `failureDetail` matches `composeRunOperatorError`, not `harness_failure` / `stop`.
- `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.

## Acceptance criteria

- [x] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` fails against the current writer, which terminalizes unconditionally; after implement, asserts deferred `failureDetail` (`code: "settlement_deferred"`, `reason: "entry_run_still_live"`, `entryRunId`, `rollupStatus`) while the stage stays `running` without `endedAt`.
- [x] `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"` fails against the current writer; after implement, adopt/settlement through the mirror-primitive `wait` does not write a `failed` or `succeeded` patch while the entry run is live.
- [x] No stage row receives `failed` or `succeeded` while its linked entry run is live (`isLiveEntryRun`).
- [x] `pipeline-stage-dispatch.test.ts` — `"deferred settlement re-settles with operator error when entry run later terminals"` fails against the current writer (premature terminal patch records `harness_failure` / `stop` or terminalizes over live entry run); after implement, re-settlement mirrors `composeRunOperatorError` on the terminal patch.
- [x] `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.
- [x] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `// @mutate` removing the settlement liveness re-check turns the pinning regression RED.
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a still-live entry run (including `paused` and other non-terminal live statuses such as `budget-soft-stopped`); reconcile the prior "never leave `running` on non-success settlement" wording with the deferred exception; what daemon `wait` guarantees and does not; declined settlement `failureDetail` (`settlement_deferred` / `entry_run_still_live`); re-settlement triggers after deferral (`continuePipeline`, adopt paths, `pipeline_resume`); `pipeline list` shows deferred `failureDetail` on `running` rows as stored; terminal non-success settlement after deferral mirrors the owning run's operator error.
- `v2/docs/v1-behaviors.md` — settlement liveness re-check, deferred-settlement visibility, re-settlement mirroring, and `pipeline list` deferred-detail visibility on pipeline stage rows.
