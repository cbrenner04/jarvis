# Foreign-owner liveness blocks stage settlement

`settleOrphanedRunningStages` (`v2/src/daemon/stage-settlement-owner.ts`) judges liveness from `isEntryRunLive` (this process only) and the entry row's own terminal/non-terminal status. `resolveWorkflowRunRollup` (`v2/src/persistence/workflow-run-status-rollup.ts`) excludes every hidden `~shrink` row from its per-step map and reacts only to a shrink row's *failure* (`failedShrink`); an `in-progress` shrink row is invisible to the rollup otherwise, and (for a `~link-N` row) `linkedRoutingFinished` counts a shrink or later-step row by existence alone, regardless of status. So once an authored step's own row is `completed`, the rollup returns `completed` even while that step's hidden `~shrink` (completion-publication) row is still `in-progress` under another live daemon's `owner_identity` — `settleLinkedStagesFromEntryRunWith` then settles the linked stage `succeeded`, or (final stage of a `ready`/`merge` pipeline with no PR evidence yet) `failed` with `completion_publication_missing_pr_evidence`, while the foreign daemon is still publishing.

Fix: before settling, treat the invocation as live when any of its sibling rows is non-terminal and its owner identity is alive. The existing `isOwnerAlive` probe (`v2/src/persistence/state-store.ts`) answers identity liveness; it is async, so the sweep becomes async.

## Decisions

- The foreign-owner gate lives in `v2/src/daemon/stage-settlement-owner.ts`'s sweep, not in `settleLinkedStagesFromEntryRunWith` — persistence stays process-liveness-free and row reconciliation is unchanged.
- `settleOrphanedRunningStages` becomes async and takes an injected owner-liveness probe defaulting to `isOwnerAlive`; the alternative (precomputing a live-identity set at the call sites and passing a sync predicate) spreads the rule across callers.
- `recoverContinuablePipelines` threads its existing `isOwnerAliveProbe` parameter into its `settleOrphanedRunningStages` call instead of letting the sweep fall back to its own default there — one injection point, not two. `resumePipeline`'s call site has no such probe in scope and keeps the sweep's default (`isOwnerAlive`).
- Probe results are memoized per identity for the duration of one sweep — one sweep can revisit the same daemon identity across many stages.
- A row owned by this daemon's own identity is not probed; local liveness already decides it.
- A null `owner_identity` on a non-terminal row does not make the invocation live — unowned non-terminal rows are exactly the interrupted case the rollup already handles.
- No workflow snapshot on the entry run means no sibling rows to enumerate — the gate is a no-op and local liveness (the entry row's own terminal/non-terminal status) decides unchanged.
- The sweep re-reads each stage's row and liveness state from the store immediately before applying the gate, rather than reusing the `listPipelines()` snapshot taken at sweep start — the sweep is now async, and an earlier stage's settlement in the same pass can change a later stage's state across the await.
- `settleStagesForEntryRun`'s other two callers (`pipeline-stage-dispatch.ts` post-wait settlement, `daemon-workflow-admission-handlers.ts` terminal-event settlement) stay synchronous with their existing `() => false` probes: both settle immediately after this same daemon dispatched and drove the entry run start-to-finish, so every sibling row written during that window carries this daemon's own `owner_identity` — a foreign live owner cannot appear there. Only the sweep (daemon start, `pipeline_resume` precondition) gains the gate.

## Task checklist

- [ ] Add the foreign-owner liveness gate to the sweep with a memoized, injectable probe, re-reading stage/row state per stage rather than off the sweep-start snapshot.
- [ ] Thread `recoverContinuablePipelines`'s existing `isOwnerAliveProbe` into its `settleOrphanedRunningStages` call.
- [ ] Await the now-async sweep at both call sites in `v2/src/daemon/pipeline-execution.ts`.
- [ ] Add the failing regression test.
- [ ] Update `v2/docs/pipeline-execution.md` and the matching `v2/docs/v1-behaviors.md` entry.

## Acceptance criteria

- [ ] A test builds an invocation whose authored step's row is `completed` and whose hidden `~shrink` sibling row is `in-progress` under a live foreign `owner_identity`, runs the startup sweep, and asserts the linked stage stays `running`; it fails against the pre-fix code (which settles it `succeeded`/`failed`).
- [ ] A test asserts the same invocation with a dead foreign owner identity still settles its stage.
- [ ] A test asserts a non-terminal sibling row owned by this daemon's own identity does not block settlement (local liveness decides, unchanged).
- [ ] `v2/src/daemon/pipeline-execution.test.ts` and `v2/src/daemon/pipeline-stage-dispatch.test.ts` stay green (settlement of locally-owned and unowned invocations unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` § Merge-day settlement — the sweep treats an invocation with a non-terminal sibling row owned by a live foreign daemon as live.
- `v2/docs/v1-behaviors.md` — update the existing pipeline-stage-settlement-liveness entry to cover the foreign-owner gate.
