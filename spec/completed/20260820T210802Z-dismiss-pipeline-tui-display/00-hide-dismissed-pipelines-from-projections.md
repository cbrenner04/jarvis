# Dismissed pipelines leave the work tree and needs-attention projections

## Problem

Every TUI projection paints whatever `mergePipelineSnapshots` returns. `buildMonitorPipelineTreeJoin` maps every snapshot to a pipeline node (`v2/src/tui/tui-monitor-pipeline-tree.ts`), `buildAttentionRows` flat-maps gate, failed-stage, publication-failure, and attributed-run incidents off every snapshot (`v2/src/tui/tui-attention-rows.ts`), and `pipelineObservationBuckets` counts every snapshot into the dock (`v2/src/tui/tui-monitor-lines.ts`). None of them read `dismissedAt`, which every snapshot has carried since `dismiss-pipeline-rpc`.

Daemon-side exclusion alone does not clear the display: `refreshRuns` retains the last-good `pipeline_list` result per socket path when a `pipelineList()` call fails (`v2/src/tui/tui-entry.tsx`), so a pipeline dismissed after that retention keeps painting — an abandoned awaiting gate keeps holding a needs-attention slot against the six-row cap, and an old failure keeps its subtree in the work tree.

## Decision ledger

- The filter lives inside `buildMonitorPipelineTreeJoin` and `buildAttentionRows`, not inside `mergePipelineSnapshots`; rules out filtering at the merge, which would deny the join the unfiltered list it needs to keep a dismissed pipeline's runs out of the ad-hoc top level.
- `collectMatchedInvocationIds` keeps reading the unfiltered `snapshots`; rules out computing it from the filtered set, which would reclassify a dismissed pipeline's attributed runs as unmatched and resurface them as ad-hoc top-level rows.
- The attention projection drops runs whose workflow invocation belongs to a hidden pipeline; rules out relying on the tree filter alone, which leaves those failed/blocked runs painting as unattributed rows labeled with their branch.
- Dock work-status buckets read the same displayed set; rules out a dock that counts gates and failures the tree and attention segment no longer show.
- The shown-dismissed marker is a space-separated `(dismissed)` suffix applied in `buildPipelineMonitorTreeRow`, not in `pipelineRowLabel`; rules out marking through the shared label helper, which also feeds attention `where` and right-pane detail projections this spec does not touch.
- `showDismissed` is an optional `TuiMonitorState` field read as `state.showDismissed === true`; rules out a required field, which would have to be threaded through every existing state literal and test fixture.
- Call sites feeding the join and the attention projection pass the **unfiltered** merge plus `{ showDismissed }`; only the dock buckets consume a pre-filtered list. Rules out pre-filtering at every call site, which silently disables the ad-hoc and attributed-run suppression above.

## Task checklist

- Add `showDismissed?: boolean` to `TuiMonitorState` in `v2/src/tui/tui-monitor-types.ts`.
- Add the hidden-pipeline predicate and a `{ showDismissed?: boolean }` options parameter to `buildMonitorPipelineTreeJoin` / `buildMonitorPipelineTree`, filter pipeline nodes by it, and mark shown dismissed rows in `buildPipelineMonitorTreeRow` (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- Add the same options parameter to `buildAttentionRows`, filter the incident sources, and drop runs owned by hidden pipelines (`v2/src/tui/tui-attention-rows.ts`).
- Thread `{ showDismissed: state.showDismissed === true }` from every state-reading call site in `v2/src/tui/tui-monitor-lines.ts` and `v2/src/tui/tui-entry.tsx`; add `displayedPipelineSnapshots(state)` and use it for `pipelineObservationBuckets`.
- Add the tests below with their in-body `// @mutate` directives to `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-attention-rows.test.ts`, and `v2/src/tui/tui-monitor-lines.test.ts`.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A pure work-tree test builds two snapshots — one dismissed (numeric `dismissedAt`, with stages, a fan-out branch, and attributed runs) and one live — and asserts the default projection contains no node whose id belongs to the dismissed pipeline (no pipeline, stage, branch, or run row) while the live pipeline's subtree is unchanged; it fails against the pre-fix model, which paints every snapshot.
- [x] A pure work-tree test asserts the same dismissed pipeline's full subtree — pipeline row, stage rows, branch node, and attributed run rows — is present when the projection is asked to show dismissed pipelines.
- [x] A pure work-tree test asserts a dismissed pipeline's attributed runs appear in no ad-hoc top-level row when dismissed pipelines are hidden.
- [x] A pure work-tree row test asserts a shown dismissed pipeline's composed row label carries the `(dismissed)` marker and a live pipeline's does not.
- [x] A pure attention-projection test asserts a dismissed pipeline holding an `awaiting` gate, a `failed` stage, and a terminal publication failure contributes no `awaiting-gate`, `failed-stage`, or `publication-failure` row, and that `total` and `overflow` count only the surviving live incidents.
- [x] A pure attention-projection test asserts a `failed` run attributed to a dismissed pipeline's stage contributes no attention row of any kind (neither an attributed row nor an unattributed branch-labeled one).
- [x] A monitor-lines test asserts a dismissed pipeline retained in `pipelineSnapshotsBySocketPath` (the last-good snapshot path) is absent from the painted work tree, the `Work (N)` heading count, the attention segment, and the dock work-status counts.
- [x] Existing `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-attention-rows.test.ts`, and `v2/src/tui/tui-monitor-lines.test.ts` suites stay green unmodified (their fixtures carry `dismissedAt: null`, so the default projection is unchanged for undismissed pipelines).
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a dismissed pipeline and its stage, branch, and run rows leave the default work tree`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the hidden-pipeline predicate's return to `false` restores baseline semantics (every snapshot paints) and turns this test red.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a dismissed pipeline's attributed runs never resurface as ad-hoc top-level rows`; Mutation checkpoint: an in-body `// @mutate` directive switching `collectMatchedInvocationIds` to the filtered snapshot list makes those runs unmatched, painting them as ad-hoc rows and turning this test red — the negative case proving the dropped subtree's runs stay dropped.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a shown dismissed pipeline row is labeled dismissed`; Mutation checkpoint: an in-body `// @mutate` directive removing the marker helper's `dismissedAt === null` early return so it always returns the plain label drops the marker and turns this test red.
- [x] `v2/src/tui/tui-attention-rows.test.ts` — `a failed run attributed to a dismissed pipeline contributes no attention row`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the hidden-run predicate's return to `false` restores the row and turns this test red — the negative case proving the suppressed run row is absent.
- [x] `v2/docs/v1-behaviors.md` — a `[v2 behavior change]` entry records that the TUI work tree, `Work (N)` heading count, needs-attention segment, and dock work-status counts no longer paint every pipeline in the snapshot: a pipeline with non-null `dismissedAt` drops with its whole subtree (stages, branches, attributed runs) and every attention row derived from it, including runs attributed to its stages, and the drop applies to snapshots retained from a last-good `pipeline_list` result; a shown dismissed pipeline row carries a `(dismissed)` label marker. Sources name `v2/src/tui/tui-monitor-pipeline-tree.ts`, `v2/src/tui/tui-attention-rows.ts`, `v2/src/tui/tui-monitor-lines.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — new `[v2 behavior change]` entry for the dismissed-excluding TUI projections (tree, Work heading count, attention segment, dock counts) and the shown-row marker.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive:

  ```ts
  // tui-monitor-pipeline-tree.ts
  export type MonitorPipelineDisplayOptions = { showDismissed?: boolean };

  /** A dismissed pipeline leaves every TUI projection unless the session opts into showing it. */
  export function isHiddenDismissedPipeline(snapshot: PipelineSnapshot, showDismissed: boolean): boolean {
    return snapshot.dismissedAt !== null && !showDismissed;
  }

  /** A shown dismissed pipeline row is marked so it never reads as live work. */
  function dismissedPipelineLabel(snapshot: PipelineSnapshot, label: string): string {
    if (snapshot.dismissedAt === null) return label;
    return `${label} (dismissed)`;
  }
  ```

  In `buildMonitorPipelineTreeJoin`, derive `displayedSnapshots` from the options, leave `const matchedInvocationIds = collectMatchedInvocationIds(snapshots);` reading the unfiltered list, and map `pipelineNodes` off `displayedSnapshots`.

  ```ts
  // tui-attention-rows.ts
  /** A hidden pipeline's attributed runs leave the attention segment with the rest of its subtree. */
  function isHiddenPipelineRun(run: DaemonListRunRow, hiddenInvocationIds: ReadonlySet<string>): boolean {
    const invocationId = run.workflow?.invocationId;
    return invocationId !== undefined && hiddenInvocationIds.has(invocationId);
  }
  ```

  Collect `hiddenInvocationIds` from the unfiltered snapshots' hidden members' `workflowInvocationId`s, keep `buildMonitorPipelineTreeJoin(snapshots, runs, options)` inside `runIncidents` reading the unfiltered list, and `continue` past hidden runs in the incident loop.
- `PipelineSnapshot.dismissedAt` is `number | null` (`v2/src/daemon/pipeline-observation.ts`); the TUI test snapshot builders in these three suites already default it to `null`, so new fixtures only need `dismissedAt: <epoch>` overrides.
- No `showDismissed: true` caller exists yet — tests drive it from `TuiMonitorState` / the options parameter directly; `01` adds the operator-reachable toggle.
