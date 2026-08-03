---
name: entry-run-settlement-terminalizes-live-rows
---

# Settlement can still terminalize a live-linked stage, and one guard from the fix is inert

## Problem

#2566 stopped the ordered-progression and fan-out writers from terminalizing a stage whose
`workflowInvocationId` names a live entry run. It did not guard the **writer** that actually records
the terminal patch.

`applyEntryRunSettlement` (`v2/src/daemon/pipeline-stage-dispatch.ts:135-142`) writes
`status: "failed"` and `endedAt: Date.now()` on any non-`completed` rollup with no `isLiveEntryRun`
re-check. It trusts `wait`. But `waitForWorkflowEntryRun` (`v2/src/daemon/daemon.ts:1758`) **does not
await anything** when `workflowPromisesByEntryRunId` has no entry for that run — it rolls up with
`isLive: false`, and `rollupWorkflowRunStatus`
(`v2/src/daemon/workflow-run-status-rollup.ts:38-45`) then returns the in-flight step's
`in-progress`, or `"killed"` for a step row that does not exist yet.

So `wait` can resolve non-`completed` over a run that is still live, and the stage is terminalized
anyway. Because `adoptAndSettlePipelineStage` can write linkage and settle in the same tick, this is
also the one remaining path that produces `startedAt == endedAt` — the exact signature observed on
2026-08-03.

In-process dispatch is safe: the promise is registered (`daemon.ts:1089`) before `resolve({runId})`.
The exposure is the **cross-process / post-restart adopt path** — which is precisely the case #2566's
adoption machinery exists to serve, so the gap sits directly under the fix.

Subspec 00's decision said settlement "rules out writing any terminal patch while the linked run is
still live." That holds at the guards and not at the writer.

## Second, smaller problem: an inert guard

`failWorkflowStageAt` (`v2/src/daemon/pipeline-execution.ts:1039`) carries a live-linkage guard whose
failure state is unreachable. All three call sites pass the same `stageRecords` snapshot from which
the caller already established the row is not `running`:

- `handleSucceededWorkflowStage:1073` — record is `succeeded`.
- `advanceFanOutStageResolution:1154`/`:1167` and `advanceWorkflowStage:1361` — the `running` case
  returned at `:1347`, before resolution is reached.

The guard re-derives the record from that identical snapshot, so it can never observe `running`. No
mutation checkpoint pins it and none could. It was mandated by subspec 01's Decisions, so this is not
an implementation error — it is the spec asking for a guard against a condition that cannot occur,
the same shape as the retired `destinationDistinctFromPredecessor`. Related:
`plan-review-must-falsify-guard-premises`.

## Decisions

- `applyEntryRunSettlement` re-checks `isLiveEntryRun` immediately before writing a non-success
  terminal patch, and declines to terminalize a still-live run — rules out `wait` resolving
  non-`completed` over a live entry run and stamping `endedAt` on it. The declined case is reported
  so a stage that cannot settle is visible rather than silently `running` forever.
- Prefer fixing the `wait` contract at its source if that proves cleaner than a defensive re-check:
  `waitForWorkflowEntryRun` returning a rollup for a run it never awaited is the underlying defect,
  and a caller-side guard is the symptom fix. Decide during planning, not implementation.
- Delete the inert `failWorkflowStageAt` guard, or give it a call site whose record can be `running`
  — rules out retaining a guard no mutation can kill. Deleting requires no behavior change, since the
  condition is unreachable.
- Out of scope: concurrent sibling dispatch (`fan-out-concurrent-sibling-dispatch`), the dispatch
  claim window (`pipeline-stage-dispatch-claim`), and `derivePipelineState` terminality.

## Acceptance criteria

- [ ] A non-`completed` rollup for an entry run that is still live does not write `failed` or
      `endedAt` on the stage; a regression fails against the current writer, which terminalizes
      unconditionally.
- [ ] A non-`completed` rollup for a genuinely settled entry run still records the composed operator
      error exactly as today.
- [ ] A stage adopted after daemon restart, whose entry run has no registered workflow promise, is
      not terminalized while that run is live — the cross-process path, driven through
      `waitForWorkflowEntryRun` rather than a stubbed `wait`.
- [ ] No stage row can be written with `endedAt` equal to its own `startedAt` while its linked entry
      run is live.
- [ ] `failWorkflowStageAt` has no unreachable live-linkage guard: either it is removed, or a
      regression constructs a call reaching it with a `running` record.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the settlement liveness re-check turns
      the live-settlement regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` each
      exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a live entry run; what `wait`
  guarantees and what it does not.
- `v2/docs/operator-runbook.md` — correct the "stays `running` until the entry run settles" claim for
  `paused` runs, which are not terminal and therefore read as live.

## Prerequisites

- #2566 (`20260803T190421Z-stage-entry-run-linkage`) shipped `liveLinkedEntryRunId`,
  `adoptAndSettlePipelineStage`, and the guards this seed extends.
