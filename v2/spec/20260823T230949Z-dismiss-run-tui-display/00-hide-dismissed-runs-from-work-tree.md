# Dismissed runs leave the work tree

## Problem

`buildMonitorPipelineTreeJoin` (`v2/src/tui/tui-monitor-pipeline-tree.ts`) filters its run input on one condition only — `runs.filter((run) => run.status !== "queued")` — and never reads `dismissedAt`, which every daemon `list` row has carried since `dismiss-run-rpc` (`v2/src/daemon/daemon-wire.ts`). So a dismissed run keeps painting as an ad-hoc top-level row and as a run leaf under a pipeline stage, and keeps a selectable id in `monitorSelectableNodeIds`.

Daemon-side exclusion does not clear the display on its own, for two reachable reasons. First, `lastGoodListBySocketPath` (`v2/src/tui/tui-entry.tsx`) is a module-level map that `refreshRuns` never prunes for a socket no longer in `clients` — unlike `pipelineSnapshotsBySocketPath`, which is explicitly rebuilt each tick from only currently-connected sockets — so a daemon that goes unreachable after listing a since-dismissed run keeps that row merged into every future `mergedRuns` snapshot indefinitely. Second, once `01` lands, `D` flips `state.showDismissed` synchronously while the run `list` request that actually drops dismissed rows resolves asynchronously; between the keystroke that turns the toggle off and that refresh completing, `state.runs` still holds the dismissed rows fetched under the prior toggle-on request, so `01`'s toggle-off criterion needs this filter too. Both paths land a dismissed run in `state.runs` with no synchronous signal to repaint around it, so the filter has to live in the pure projection rather than relying on the daemon or the request parameter alone.

The pipeline half of this vocabulary already exists in the same module — `isHiddenDismissedPipeline`, `dismissedPipelineLabel`, and the `MonitorPipelineDisplayOptions.showDismissed` option threaded from `TuiMonitorState` — with nothing equivalent for runs.

## Decision ledger

- The run filter applies to `builderRuns` at the top of `buildMonitorPipelineTreeJoin`, alongside the existing `status !== "queued"` exclusion; rules out filtering only the ad-hoc candidate list, which would leave dismissed run leaves painting under pipeline stages.
- Dismissal is per-run, so a workflow-collapsed row drops exactly its dismissed members: a node vanishes only when every run backing it is dismissed. Rules out dropping a whole invocation because its entry run is dismissed, which would hide step rows the operator never dismissed and contradicts the documented per-row model (`v2/docs/operator-runbook.md` § Run dismiss and undismiss).
- A partially-dismissed workflow group re-derives its identity and status from its surviving undismissed members only: filtering `builderRuns` ahead of `buildWorkflowTableRows` drops a dismissed member out of `members`, so `workflowGroupRepresentative`/`workflowGroupRollupRunStatus` recompute over what remains — the group's node id, label, rolled-up status, and dock bucket can all change the moment its entry or a failed step is dismissed, same as if that run had never joined the invocation. Accepted, not guarded: rules out anchoring the group's identity to its pre-dismissal representative, which would require carrying a dismissed run's data back into an otherwise-filtered member list to hold a stable id/label for a run the operator can no longer act on anyway.
- A stage keeps its row when every run under it is dismissed, and simply becomes a non-expandable leaf (`isStructurallyExpandableTreeNode` already reads the elided `runs` collection); rules out dropping a stage whose only visible run is dismissed, which would erase durable stage status the dismissal never touched.
- Filtering `builderRuns` ahead of the join also removes dismissed runs from stage-claim inputs (`collectStageBranchClaims`) and from `derivePipelineProject`, not only from painted rows: a stage whose only recorded-invocation runs are dismissed forfeits its branch claim, so a live invocation that would have attributed to it by branch instead surfaces as a top-level ad-hoc row; and a pipeline whose sole invocation-joining run for every recorded stage is dismissed blanks its `project` field. Accepted, not guarded: both are the direct consequence of treating a dismissed run as absent from the one joined run list every projection reads, the same choice this spec already makes for painted rows; rules out a second unfiltered run list threaded past the filter to preserve claims/project/timing, which would let a dismissed run keep steering live display state the operator dismissed it specifically to stop tracking.
- A dismissed run's own failed/blocked attention row is suppressed by the same predicate and toggle as its work-tree row, applied in `runIncidents` (`v2/src/tui/tui-attention-rows.ts`), symmetric with `isHiddenPipelineRun`'s existing suppression of runs attributed to a dismissed pipeline. Rules out leaving that row in place once its target run leaves the join: `where`/`targetId` resolve from the same filtered join, so once this spec's filter lands, an unsuppressed incident silently strands a stale label and a dead `Enter reveal` rather than the pre-existing pipeline-attribution gap the index still leaves out of scope.
- The queue segment (`monitorLeftPaneQueueRows`) stays untouched: it paints `state.runs` filtered to `status === "queued"` directly, never through `builderRuns` or this spec's predicate, and the join already excludes queued runs on both sides. A dismissed queued run therefore keeps painting unmarked regardless of the toggle; ruled out of scope here as a distinct, pre-existing display path this spec's "work tree" does not cover.
- The marker is a space-separated `(dismissed)` suffix applied in `buildTreeRunRow` (`v2/src/tui/tui-monitor-lines.ts`), the single composer for both run leaves and ad-hoc rows, not in `runRowLabel`; rules out marking through the shared label helper, which also feeds right-pane detail projections this spec does not touch.
- A workflow-collapsed row's marker follows its representative run (`monitorTreeRun`); rules out marking a group because any member is dismissed, which would mark a live group for one shed step row.
- `dismissedAt` is read as `(run.dismissedAt ?? null) !== null`, matching the daemon's own idiom; rules out `run.dismissedAt !== null`, which is `true` for the optional-absent field the wire type permits.

## Task checklist

- Add `isHiddenDismissedRun` and `dismissedRunLabel` to `v2/src/tui/tui-monitor-pipeline-tree.ts` next to their pipeline counterparts, and apply the predicate to `builderRuns` in `buildMonitorPipelineTreeJoin` (hoist the existing `showDismissed` const above `builderRuns`).
- Apply `dismissedRunLabel` to the composed label in `buildTreeRunRow` (`v2/src/tui/tui-monitor-lines.ts`), covering the `labelOverride` ad-hoc path and the `runRowLabel` run-leaf path alike.
- Guard `runIncidents` (`v2/src/tui/tui-attention-rows.ts`) with `isHiddenDismissedRun`, skipping a dismissed run's own failed/blocked incident row when the session is not showing dismissed runs.
- Add the tests below with their in-body `// @mutate` directives to `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, and `v2/src/tui/tui-attention-rows.test.ts`.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A pure work-tree test builds an ad-hoc workflow group whose every member run carries a numeric `dismissedAt`, plus an undismissed ad-hoc run and a live pipeline subtree, and asserts the default projection contains no node id belonging to the dismissed group (neither its collapsed row nor any expanded member) while the undismissed run and the pipeline subtree are unchanged; it fails against the pre-fix model, which paints every non-queued run.
- [ ] A pure work-tree test asserts that same dismissed group's collapsed row and expanded member rows are present when the projection is asked to show dismissed runs.
- [ ] A pure work-tree test asserts a dismissed run leaf leaves its pipeline stage while the stage row itself survives: a stage whose only run is dismissed still yields a stage node, now with an empty `runs` collection and a blank (non-expandable) marker, and a sibling stage keeps its undismissed run leaf.
- [ ] A pure work-tree test builds a workflow-collapsed group whose entry run is `failed` and dismissed and whose only other member is `completed`, and asserts the default projection's collapsed row is keyed on and labeled from the surviving `completed` run — not the dismissed entry — with rolled-up status `completed`; it fails against a model that keeps the dismissed entry as the group's representative.
- [ ] A pure work-tree test builds a stage whose only recorded-invocation run is dismissed and a separately-recorded live run sharing that stage's (project, branch) with no recorded invocation of its own, and asserts that live run surfaces as a top-level ad-hoc node rather than nested under the stage once its only claim-eligible run is dismissed; it fails against a model that computes stage claims off the unfiltered run list.
- [ ] A pure test over `buildAttentionRows` (`v2/src/tui/tui-attention-rows.ts`) asserts a dismissed failed run's attention row is absent from the default projection and present, with a resolvable `targetId`, when dismissed are shown; it fails against the pre-fix `runIncidents`, which keeps the row while its target leaves the join.
- [ ] A monitor-lines test asserts a dismissed run present in `TuiMonitorState.runs` — the last-good-list retention path for a socket no longer live, or the pre-refresh state carried over one toggle-off round trip — is absent from the painted work tree rows and from the `Work (N)` heading count.
- [ ] A monitor-lines row test asserts a shown dismissed run's composed row label carries the `(dismissed)` marker on both an ad-hoc row (branch `labelOverride` path) and a stage run leaf, and that an undismissed run's does not.
- [ ] The existing tests in `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, and `v2/src/tui/tui-attention-rows.test.ts` stay green (their run fixtures default `dismissedAt` to `null`, so the default projection is unchanged for undismissed runs).
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a dismissed ad-hoc run group leaves the default work tree`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the hidden-run predicate's return to `false` restores baseline semantics (every non-queued run paints) and turns this test red.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a dismissed ad-hoc run group paints when the projection shows dismissed runs`; Mutation checkpoint: an in-body `// @mutate` directive dropping the `!showDismissed` term from the hidden-run predicate hides the group in both modes and turns this test red — the negative case proving the suppression is conditional on the session option, not unconditional.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a shown dismissed run row is labeled dismissed`; Mutation checkpoint: an in-body `// @mutate` directive removing the run marker helper's `dismissedAt === null` early return so it always returns the plain label drops the marker and turns this test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `a dismissed run's own attention row is suppressed`; Mutation checkpoint: an in-body `// @mutate` directive dropping the new hidden-run guard from `runIncidents` restores baseline semantics (a dismissed run's incident row survives with an unresolvable target) and turns this test red.
- [ ] `v2/docs/v1-behaviors.md` — the existing `[v2 behavior change]` TUI-display entry (the one recording that dismissed pipelines drop from the work tree, `Work (N)` count, attention segment, and dock counts) is extended to runs, stating each of the four explicitly: a run with non-null `dismissedAt` leaves the work tree (ad-hoc top-level row and run leaf alike) and the attention segment (its own failed/blocked incident row), changes the `Work (N)` count and dock running/done/failed counts for the ad-hoc groups it was part of, and drops even when retained from a stale last-good `list` result or a toggle-off round trip in flight; a stage whose only run is dismissed keeps its row as a non-expandable leaf and, if that was its only claim-eligible run, stops attributing a live matching-branch invocation to it; a pipeline whose every recorded-stage run is dismissed shows a blank `project` field; dismissal is per-run, so a workflow-collapsed row drops only its dismissed members and re-derives its representative and rolled-up status from the survivors; the queued segment is unaffected (queued runs never join this projection); a shown dismissed run row carries a `(dismissed)` label marker. Sources name `v2/src/tui/tui-monitor-pipeline-tree.ts`, `v2/src/tui/tui-monitor-lines.ts`, and `v2/src/tui/tui-attention-rows.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the existing dismissed-excluding TUI-projection `[v2 behavior change]` entry to cover runs, the run-row marker, and the run-side attention-row suppression.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive:

  ```ts
  // tui-monitor-pipeline-tree.ts, beside isHiddenDismissedPipeline / dismissedPipelineLabel
  /** A dismissed run leaves the work tree unless the session opts into showing dismissed work. */
  export function isHiddenDismissedRun(run: DaemonListRunRow, showDismissed: boolean): boolean {
    return (run.dismissedAt ?? null) !== null && !showDismissed;
  }

  /** A shown dismissed run row is marked so it never reads as live work. */
  export function dismissedRunLabel(run: DaemonListRunRow, label: string): string {
    if ((run.dismissedAt ?? null) === null) return label;
    return `${label} (dismissed)`;
  }
  ```

  In `buildMonitorPipelineTreeJoin`, move `const showDismissed = options.showDismissed === true;` above the `builderRuns` line and widen that line to `const builderRuns = runs.filter((run) => run.status !== "queued" && !isHiddenDismissedRun(run, showDismissed));`. Nothing else in the join needs to change: `matchedInvocationIds` keeps reading the unfiltered `snapshots` (pipeline snapshots, not runs), and both the ad-hoc candidate list and every stage's run join already derive from `builderRuns`.

  ```ts
  // tui-monitor-lines.ts, in buildTreeRunRow
  label: dismissedRunLabel(run, labelOverride ?? runRowLabel(tableRow)),
  ```

  `run` is already bound there as `monitorTreeRun(tableRow)`, so the representative supplies both the marker and the status/liveness atoms.
- The two new helper bodies must not collide textually with the pipeline ones: the pipeline predicate reads `return snapshot.dismissedAt !== null && !showDismissed;` and its label helper `if (snapshot.dismissedAt === null) return label;`, so the `run.`/`?? null` forms above stay unique `@mutate` anchors within the file.
- `DaemonListRunRow.dismissedAt` is `number | null | undefined` (optional on the wire type, always present from the daemon). The TUI run fixtures in both suites already default it to `null`, so new fixtures need only a `dismissedAt: <epoch>` override.
- No `showDismissed: true` run caller exists yet — these tests drive it from the options parameter / `TuiMonitorState` directly; `01` makes the daemon actually return dismissed runs for the toggle to reveal.
- In `runIncidents` (`v2/src/tui/tui-attention-rows.ts`), skip a run at the top of the loop that builds `rows` when `isHiddenDismissedRun(run, options.showDismissed === true)`, mirroring the existing `isHiddenPipelineRun` skip already in `buildRunIncidentRow`. This needs `isHiddenDismissedRun` exported from `tui-monitor-pipeline-tree.ts`, which it already is for `tui-monitor-lines.ts`'s use.
