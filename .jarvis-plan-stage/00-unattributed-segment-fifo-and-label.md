# Unattributed segment FIFO and label

Unattributed runs render below the pipeline tree but still use the legacy one-hour / twenty-row `filterMonitorRunsForLiveWindow` path and have no segment heading with retained cardinality.

## Problem

Unattributed runs appear in the left pane without the FIFO retention rule or segment count label the brief specifies for every segment.

## Decisions

- Replace `filterMonitorRunsForLiveWindow` for unattributed candidates with brief § Left pane FIFO within the unattributed segment only — rules out keeping the one-hour / twenty-row live window for orphans.
- Active unattributed runs (non-terminal status) are never dropped by segment FIFO — rules out evicting in-progress orphans before terminals.
- Terminal unattributed orphans drop oldest-by-`finishedAtMs` first when retained rows would exceed the segment row budget — rules out newest-first terminal ordering or unbounded terminal accumulation.
- Unattributed segment FIFO is independent of pipeline-tree flatten/viewport retention — rules out reusing `maxVisibleRows` tree paint budget or changing pipeline-tree join behavior (out of scope per intent).
- Segment heading text is `─ Unattributed (N) ─` where `N` is the retained unattributed row count after FIFO — rules out a bare separator or a count of pre-FIFO candidates.
- `monitorSelectableNodeIds` and navigation continue to walk every retained unattributed row in pane order after FIFO — rules out trimming selectables separately from painted rows.
- Deferred to first consumer: exact segment row budget formula from left-pane layout (tree paint height, heading row, queue block) — pin when wiring `monitorLeftPaneTreeRows` / ink paint with measured layout inputs.
- Deferred to first consumer: whether the unattributed heading renders at `N = 0` with no orphan candidates — pin when the label regression fixture is authored; brief layout shows `─ Unattributed (0) ─`.
- `tui-overhaul-brief.md` slice-6 **shipped** marker waits for sibling steering / wait-removal / detail-windowing intents to merge — rules out closing slice 6 in the meta-index from this capstone alone.

## Prerequisites

- `buildMonitorPipelineTreeJoin` filters orphan candidates and emits `unattributedRows` via `isUnattributedCandidate` plus `buildWorkflowTableRows` (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- `monitorLeftPaneTreeRows` returns `unattributedRows` from `buildMonitorPipelineTree` after tree flatten/viewport slice (`v2/src/tui/tui-monitor-lines.ts`).
- Pipeline-tree left-pane retention is settled: full flatten drives selectables; painted tree rows are a viewport window — not changed here (`v2/spec/completed/20260801T154236Z-tui-pipeline-tree-retain-full-flatten`, `v2/spec/completed/20260801T154746Z-tui-monitor-scroll-viewport-selectables`).
- Fan-out: lands after `tui-remove-waitstate-window-detail` merges or in parallel on `tui-monitor-lines.ts` (disjoint from the steering chain through `tui-dock-log-follow`).

## Tasks

- Add unattributed-segment FIFO retention in the join path (replace the `filterMonitorRunsForLiveWindow` call for unattributed candidates) with active-always / oldest-terminal-first eviction under the segment budget.
- Export or derive a pure left-pane unattributed heading row (`─ Unattributed (N) ─`) from retained `unattributedRows` count; wire ink left-pane paint to render heading before unattributed run rows (mirror the `Queue` heading pattern).
- Add `tui-monitor-pipeline-tree.test.ts` regression `unattributed segment FIFO retains active runs and drops oldest terminals first` with a fixture that overflows the segment budget; include `// @mutate` in the test body inverting the active-retention guard on the new FIFO path.
- Add `tui-monitor-lines.test.ts` regression `left pane labels unattributed segment with retained run count` asserting the heading text and `N` match post-FIFO retained rows (pure monitor-lines / state derivation, not rendered-ink assertions).
- Preserve existing unattributed candidate membership pins (`isUnattributedCandidate`, stage-matched exclusion, `monitorSelectableNodeIds` pane order).
- Run `bun run typecheck`, `bun run check`, and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first` covers retention ordering and fails against the pre-fix code.
- [ ] `tui-monitor-lines.test.ts` test `left pane labels unattributed segment with retained run count` fails against the pre-fix code.
- [ ] Mutation checkpoint: in `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first`, a `// @mutate` directive inverting the FIFO retention guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the unattributed one-hour / twenty-row live-window entry with brief FIFO within the unattributed segment (active retained; oldest terminal orphans drop first).
- `v2/docs/operator-runbook.md` § Observe — document unattributed segment FIFO and the `─ Unattributed (N) ─` heading; remove one-hour / twenty-row wording for the unattributed segment.
- `v2/spec/tui-overhaul-brief.md` — clear the "no FIFO or labelling polish" gap for unattributed; when all slice-6 siblings are merged, mark slice 6 shipped and note steering, log follow, wait removal, detail windowing, and unattributed FIFO are in-dock.
