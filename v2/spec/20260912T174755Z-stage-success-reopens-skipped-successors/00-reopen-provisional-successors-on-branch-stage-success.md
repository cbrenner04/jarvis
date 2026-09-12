# Reopen provisional skips when a branch stage settles succeeded

## Problem

`settleFanOutBranch` (`v2/src/daemon/pipeline-execution.ts`) skips a branch's suffix (`skipRemainingStages`, `skipProvenance: "provisional"`) whenever a branch stage settles to anything other than `succeeded` — including a `running` row with no live linked entry run (`settleFanOutBranch`'s fallthrough) and other non-`succeeded` terminal statuses such as `interrupted`. That skip is written once and never withdrawn. Such a row can later settle `succeeded` via `adoptRunningWorkflowStage` with no `failed` row ever written anywhere on the branch. `pipeline resume` and `pipeline recover` both reopen a branch suffix only by finding a `failed` anchor row (`analyzeFailedPipelineReopenShapeOnStages` refuses `no_failed_stage` otherwise), so no operator verb can free the stranded successor — the lane sits at `plan: succeeded` + `implement: skipped` and the execution loop walks past a successor that will never dispatch. A branch that *did* fail first is already covered: `resume`/`recover` reopen its suffix today.

`StateStore.reopenProvisionalSkippedStages({ pipelineId, branchKey })` already flips exactly the provisional-skipped rows of one branch back to `pending` with lifecycle fields cleared, needs no `failed` anchor row, and leaves `skipProvenance: "terminal"` rows (split-retired `default` suffix) untouched. This subspec wires the `succeeded` arm of branch settlement to it.

## Decisions

- The reopen fires from `settleFanOutBranch`'s `succeeded` arm, scoped to that arm's `targetBranchKey` — the one place branch settlement observes a stage success with a possibly-stale suffix.
- The reopen reuses `store.reopenProvisionalSkippedStages` rather than an inline suffix rewrite; that store call is already the atomic, terminal-skip-respecting writer, and re-deriving skip provenance in the execution loop would duplicate it.
- The success write (linked-entry-run settlement) and the reopen (settlement observation inside `settleFanOutBranch`) are separate transactions — settlement observation is the only place the execution loop can see a possibly-stale suffix, not the write that produced the success. The reopen is unconditional on every `succeeded` observation, so a crash between the two self-heals: the next pass re-observes `succeeded` and reopens then.
- The reopen is unconditional on the `succeeded` arm, not gated on the row having previously failed: `reopenProvisionalSkippedStages` is a no-op when there are no provisional skips, so a first-pass success pays one query and needs no extra history predicate.
- A `refused` outcome (`pipeline_not_found`) is explicitly discarded, not silently dropped: the branch's own `succeeded` row was just loaded from that pipeline, so the reason is unreachable here and the arm's return value is unchanged.
- `settleFanOutBranch` keeps returning `false` on the `succeeded` arm — reopening successors does not make this pass "acted"; the reopened rows dispatch on the normal loop's next pass, with no operator verb. Its doc comment is updated: the `succeeded` arm is now a mutator (it can reopen successors), not a pure observer.
- Reopened rows are visible only starting on the execution loop's next pass: `advanceFanOutBranches` snapshots `opts.loadedStages` once per pass, so sibling-branch tasks already in flight in the same pass never see the reopen mid-flight.
- Positional scope is the whole branch, not strictly `index + 1`: every `skipRemainingStages` call site starts strictly after the settling stage's position (`index + 1` / `record.position + 1`), so no provisional skip can exist at or before the settled position — a whole-branch reopen cannot touch a row the settled stage's own success didn't cause.

## Task checklist

- [ ] Call `store.reopenProvisionalSkippedStages({ pipelineId, branchKey: targetBranchKey })` on the `succeeded` arm of `settleFanOutBranch`; update its doc comment to note the arm now mutates.
- [ ] Add the pipeline test below.
- [ ] Update `v2/docs/pipeline-execution.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/pipeline-execution.test.ts` drives `settleFanOutBranch`'s existing non-`succeeded` fallthrough (e.g. a `running` branch stage settling with no live linked entry run) so its successor is skipped with `skipProvenance: "provisional"` and no `failed` row is ever written on the branch — not by hand-seeding a `skipped` row. It then re-drives that stage to `succeeded` and asserts the successor row is `pending` with `skipProvenance` cleared; it fails against the pre-fix code, where the successor stays `skipped`. Reachability on the pre-fix base: with no `failed` row on the branch, both `pipeline resume` and `pipeline recover` refuse `no_failed_stage`, so no operator verb can free the successor.
- [ ] The same scenario, run through one further execution-loop pass, asserts the reopened successor dispatches; the settling pass's own in-flight `advanceFanOutBranches` call (holding the pre-reopen `opts.loadedStages`) does not dispatch it early.
- [ ] The same scenario asserts the branch's stage rows at or before the settled stage's position are unchanged by the reopen.
- [ ] `state-store.test.ts`'s "reopens only provisional skips on the default branch and clears lifecycle fields without a failed anchor" test stays green (terminal-skip and legacy-null-provenance exclusion for `reopenProvisionalSkippedStages` is already pinned at the store layer; not re-proved here against `pipeline-execution.test.ts`'s fake store).
- [ ] `state-store.test.ts`'s "provisional skip reopen is branch-scoped and leaves a failed row unchanged" test stays green (branch scoping for `reopenProvisionalSkippedStages` is already pinned at the store layer).
- [ ] `v2/docs/pipeline-execution.md` documents that a branch stage settling `succeeded` reopens that branch's provisional skips to `pending`, leaves terminal skips, sibling branches, and pre-`skip_provenance`-column legacy skips untouched, dispatches only on the loop's next pass, and needs no operator verb.
- [ ] `v2/docs/v1-behaviors.md` records the execution-layer change: a fan-out branch suffix skip — including one written with no `failed` row ever appearing on the branch — is no longer terminal-by-default, distinct from the existing store-level `StateStore.reopenProvisionalSkippedStages` entry.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — fan-out lane bullets: successor reopen on stage success alongside the existing `Branch failure → skipRemainingStages` bullet; note the legacy-skip and next-pass-visibility limits.
- `v2/docs/v1-behaviors.md` — one entry for the execution-layer reopen, distinct from the existing store-call entry.
