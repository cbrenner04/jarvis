---
name: pipeline-stage-run-join-resolves-entry-run-id
---

# The pipeline tree joins a stage to its runs through the entry run id it actually records

## Problem

Since #2566 (2026-08-03, "Stage linkage follows the admitted entry run"), `writeRunningStageLinkage` (`v2/src/daemon/pipeline-stage-dispatch.ts`) stores the **entry run id** in `stage.workflowInvocationId`, and that file's own helpers read the field back as `entryRunId` — the field name no longer matches its contents, and the wire projection (`v2/src/daemon/pipeline-observation.ts`) forwards it unchanged. Run rows carry a **distinct workflow invocation UUID** in `workflow.invocationId`.

The TUI join (`v2/src/tui/tui-monitor-pipeline-tree.ts:480,633`) matches `run.workflow?.invocationId === stage.workflowInvocationId` with no run-id fallback, so **no run has joined any pipeline stage since #2566**. Every pipeline workflow paints as a top-level ad-hoc row alongside the pipeline subtree — the operator-reported double-print (re-observed 2026-08-28). Compounding: the #2959 branch-aware attribution builds a stage's claim set *from its joined runs*, so every claim set is empty and that entire shipped fix is inert in production despite 12 green tests — its fixtures encode the pre-#2566 assumption that the stage field holds an invocation id.

Live proof (pipeline `af881ac0`, 2026-08-28): the intent stage records `workflowInvocationId b3e6d0fc-…`, equal to its artifact's `entryRunId`; run `b3e6d0fc-…` exists and carries `workflow.invocationId ea3f38c9-…`, equal to the artifact's `invocationId`. Same shape on every stage of the pipeline.

## Decisions

- The projection resolves the stage's recorded entry run id to its run row (`run.runId === stage.workflowInvocationId`) and joins on **that run's** `workflow.invocationId`; run ids are globally unique UUIDs so no daemon/project scoping is added to the lookup. Rules out changing what dispatch/settlement/recovery store — `pipeline-stage-dispatch.ts` and `pipeline-stage-recovery.ts` read the field as an entry run id throughout, and a store/wire migration is a bigger blast radius than a projection-side resolve.
- Renaming the misnamed field (`workflowInvocationId` → `entryRunId`) end-to-end (store, wire, TUI) is in scope for the plan to decide; the resolution logic is required either way. Rules out leaving the trap for the next consumer without at least a decision on record.
- An entry run id that resolves to no retained run row joins nothing — the stage renders without runs and its claim set is empty, same as today; sibling runs of its invocation stay ad-hoc because nothing can resolve their invocation. This is the retention-window honesty #2959's ledger already accepted, restated for the resolve step. Rules out guessing an invocation from branch alone.
- #2959's branch-aware attribution must come alive under the fix: claim sets build from the runs joined via the resolved invocation id, unchanged in shape. Its existing tests are **re-fixtured, not deleted** — every pipeline-tree fixture moves to the production id relationship (stage records an entry *run* id distinct from the runs' invocation UUID). Rules out keeping fixtures whose stage field equals the invocation id, which is how this shipped green while dark.
- `collectMatchedInvocationIds` (`tui-monitor-pipeline-tree.ts:331`) and every other consumer of `stage.workflowInvocationId` in the TUI move to the resolved invocation id in the same change; rules out fixing the two join sites and leaving the suppression set matching run ids.

## Acceptance criteria

- [ ] A stage recording an entry run id whose run row carries a distinct `workflow.invocationId` joins that run (and its invocation's sibling runs) under the stage, and none of them emits a top-level ad-hoc row — pinned by a pure-function test over `buildMonitorPipelineTreeJoin` reproducing the `b3e6d0fc`/`ea3f38c9` shape; fails against the current direct field comparison.
- [ ] One #2959 branch-aware case (the same-branch leaked-invocation keystone) re-pinned with a production-shaped fixture passes — proving branch attribution is live again; it fails against the current code where the empty claim set leaves the leak ad-hoc.
- [ ] A stage whose recorded entry run id resolves to no retained run row renders without joined runs and contributes no claims, and no run is mis-attributed to it — pinned by a test.
- [ ] A genuinely stage-less workflow invocation still renders as a top-level ad-hoc row (no over-suppression from the resolve step), pinned by a test.
- [ ] No pipeline-tree fixture retains the legacy shape where `stage.workflowInvocationId` equals a run's `workflow.invocationId` unless the test's subject is the resolve fallback itself, verified in review of the re-fixturing.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — the TUI pipeline-tree entry: the stage field records the entry run id (#2566) and the projection resolves it to the invocation before joining; correct the #2959 entry's description of the recorded id.
- `v2/docs/operator-runbook.md` — Observe section: same correction; note fixtures must mirror the production id relationship.
