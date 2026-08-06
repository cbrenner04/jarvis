# Settlement liveness and deferred detail

## Problem

`applyEntryRunSettlement` writes `failed` and `endedAt` on any non-`completed` rollup without re-checking `isLiveEntryRun`. After daemon restart, `adoptAndSettlePipelineStage` can call `wait` through `waitForWorkflowEntryRun`, which resolves a non-`completed` rollup without awaiting when no workflow promise is registered — terminalizing a still-live entry run and allowing `startedAt == endedAt` on the stage row.

## Surface

Primary: `v2/src/daemon/pipeline-stage-dispatch.ts` (`applyEntryRunSettlement`, `settlePipelineStageFromEntryRun`, `adoptAndSettlePipelineStage`). In-scope: `pipeline-stage-dispatch.test.ts`, `daemon.ts` `waitForWorkflowEntryRun` rollup semantics only as test fixture contract (no source repair in this subspec).

## Decisions

- Repair at settlement: `applyEntryRunSettlement` re-checks `isLiveEntryRun(store, entryRunId)` immediately before writing any non-`completed` terminal patch and declines to terminalize when the entry run is still live — rules out fixing `waitForWorkflowEntryRun` at its source in this slice.
- Declined non-success settlement leaves the stage `running` without `endedAt` and records `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live", entryRunId, rollupStatus }` until a later settlement attempt succeeds or the entry run actually settles — rules out a silent `running` row with no operator-visible signal in `pipeline list`.
- `paused` entry runs are live (`isLiveEntryRun` / non-terminal durable status); declined settlement applies to them the same as `in-progress` — rules out terminalizing a paused entry run from a premature non-`completed` rollup.
- Success (`rollupStatus === "completed"`) settlement is unchanged: still terminalizes even when the entry run row reads live until the success patch lands.
- Existing non-success `failureDetail` mirroring via `composeRunOperatorError` on settled entry runs stays intact — rules out regressing `completion_commit_failed` / `resume` shaping when settlement is not deferred.
- Out of scope: `derivePipelineState` terminality, `waitForWorkflowEntryRun` contract change, base-ref retarget, `failWorkflowStageAt` guard deletion, concurrent sibling dispatch.

## Task checklist

- In `applyEntryRunSettlement`, before the non-`completed` terminal `updateStage`, return early when `isLiveEntryRun(store, entryRunId)`; write the deferred `failureDetail` shape on the `running` row (no `endedAt`, no `status` change away from `running`).
- Add `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `wait` returns a non-`completed` rollup while `store.loadRun(entryRunId)` remains non-terminal; assert stage stays `running` without `endedAt` and `failureDetail` matches the deferred shape; pin `// @mutate` on the liveness guard so inverting it turns the regression RED.
- Add `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"`: exercise adopt/settlement through a `wait` primitive that mirrors `waitForWorkflowEntryRun` (no in-flight workflow promise; rollup from durable non-terminal entry-run state) — not a stub that unconditionally returns `failed` while the store still shows live.
- Assert no stage patch sets `endedAt` equal to the row's own `startedAt` while the linked entry run is live (cover in the live-decline tests or a dedicated assertion).
- `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` fails against the current writer, which terminalizes unconditionally; after implement, asserts deferred `failureDetail` (`code: "settlement_deferred"`, `reason: "entry_run_still_live"`, `entryRunId`, `rollupStatus`) while the stage stays `running` without `endedAt`.
- [ ] `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"` fails against the current writer; after implement, the cross-process adopt path does not write a terminal patch while the entry run is live.
- [ ] No stage row is written with `endedAt` equal to its own `startedAt` while its linked entry run is live.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `// @mutate` removing the settlement liveness re-check turns the pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a still-live entry run (including `paused`); what daemon `wait` guarantees and does not; declined settlement `failureDetail` (`settlement_deferred` / `entry_run_still_live`); reconcile the prior "never leave `running` on non-success settlement" wording with the deferred exception.
- `v2/docs/v1-behaviors.md` — record settlement liveness re-check and deferred-settlement visibility on pipeline stage rows.
