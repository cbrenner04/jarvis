# Unattributed segment FIFO and label

Unattributed runs render below the pipeline tree but still use the legacy one-hour / twenty-row `filterMonitorRunsForLiveWindow` path and have no segment heading with retained cardinality.

## Problem

Unattributed runs appear in the left pane without the FIFO retention rule or segment count label the brief specifies for every segment.

## Decisions

- Replace `filterMonitorRunsForLiveWindow` for unattributed candidates with brief § Left pane FIFO within the unattributed segment only — rules out keeping the one-hour / twenty-row live window for orphans.
- **Eviction ownership:** `buildMonitorPipelineTreeJoin` keeps membership filtering and `buildWorkflowTableRows` only (no retention cap); `monitorLeftPaneTreeRows` in `tui-monitor-lines.ts` derives the segment body budget, applies FIFO to post-collapse unattributed rows, sorts retained rows, and returns the capped list — rules out join-layer eviction with a test-only budget or split eviction across layers.
- **Segment body budget:** export `leftPaneUnattributedBodyRowBudget(state, layout)` from `tui-monitor-lines.ts` as `max(0, layout.paneHeight - treeRowsPainted - 1 - leftPaneQueueHeadingRowCount(state))` where `treeRowsPainted` is the painted tree viewport row count (`treeRows.length` from the same derivation ink paints) and `1` is the always-on unattributed heading row — rules out an arbitrary join default or a fixture-only cap.
- Queue **body** rows do not subtract from the unattributed budget (same queue-heading-only treatment slice 2 uses for tree `maxVisibleRows`) — rules out double-counting queue rows against both tree and unattributed budgets.
- Regression fixtures and production both call `leftPaneUnattributedBodyRowBudget` (or the exported FIFO helper that accepts its output) — rules out a test-local overflow cap disconnected from layout.
- **FIFO units:** operate on post-collapse `WorkflowTableRow` entries; active retention uses `workflowGroupHasActiveMember` on the row's member runs (non-terminal members); terminal eviction uses `workflowRollupFinishedAtMs` per collapsed row — rules out per-raw-run `finishedAtMs` that disagrees with grouped orphans.
- Active unattributed rows are never dropped by segment FIFO; when actives alone exceed the body budget they all remain — rules out evicting in-progress orphans before terminals or capping actives to fit the budget.
- Terminal unattributed orphans drop oldest-by-rollup-finish first when retained body rows would exceed the segment body budget — rules out newest-first terminal ordering or unbounded terminal accumulation.
- **Finishless terminal orphans** (`finishedAtMs` / rollup finish undefined) are never dropped by terminal FIFO eviction (parity with legacy `terminalRunInLiveWindow(undefined)` keep) — rules out treating unknown-finish terminals as oldest-first eviction victims.
- **Zero body budget:** heading still renders; terminal body rows evict to zero; active rows remain even when that exceeds the budget — rules out undefined behavior when tree plus headings consume the pane.
- **Post-FIFO pane order:** actives top sorted by earliest member `createdAt`, terminals below sorted by rollup finish oldest-first (brief § Left pane FIFO sort keys) — rules out input-order retention that passes id-only tests with wrong operator-visible ordering.
- Unattributed segment FIFO is independent of pipeline-tree flatten/viewport retention — rules out reusing `maxVisibleRows` tree paint budget or changing pipeline-tree join behavior (out of scope per intent).
- Segment heading text is always `─ Unattributed (N) ─` where `N` is the retained unattributed body row count after FIFO, including `N = 0` with no orphan candidates — rules out a bare separator, a pre-FIFO count, or Queue-style heading omission when empty.
- **Label derivation surface:** export `monitorLeftPaneUnattributedSegmentRows(state, layout, nowMs)` (name need not be exact) returning the heading row plus post-FIFO body rows; ink left-pane paint calls this helper (extend `monitorLeftPaneContentRows` or call alongside `monitorLeftPaneTreeRows`) — "mirror Queue" means heading-before-body segment wiring like `monitorLeftPaneQueueRows`, not Queue's empty-segment omission.
- `monitorSelectableNodeIds` and navigation continue to walk every retained unattributed body row in post-FIFO pane order — rules out trimming selectables separately from painted rows.
- `tui-overhaul-brief.md` slice-6 **shipped** marker waits for sibling steering / wait-removal / detail-windowing intents to merge — rules out closing slice 6 in the meta-index from this capstone alone.
- Subspec supersedes `intent.md` for documentation updates and slice-6 shipped gating.

## Prerequisites

- `buildMonitorPipelineTreeJoin` filters orphan candidates and emits uncollapsed `unattributedRows` via `isUnattributedCandidate` plus `buildWorkflowTableRows` (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- `monitorLeftPaneTreeRows` returns `unattributedRows` from `buildMonitorPipelineTree` after tree flatten/viewport slice (`v2/src/tui/tui-monitor-lines.ts`).
- Pipeline-tree left-pane retention is settled: full flatten drives selectables; painted tree rows are a viewport window — not changed here (`v2/spec/completed/20260801T154236Z-tui-pipeline-tree-retain-full-flatten`, `v2/spec/completed/20260801T154746Z-tui-monitor-scroll-viewport-selectables`).
- Fan-out: capstone of slice 6; lands serially after `tui-remove-waitstate-window-detail` merges (same `tui-monitor-lines.ts` seam — not parallel).

## Tasks

- Remove `filterMonitorRunsForLiveWindow` from `buildMonitorPipelineTreeJoin`; join emits post-collapse unattributed candidates only.
- Add `leftPaneUnattributedBodyRowBudget` and pure `retainUnattributedSegmentFifo` (names need not be exact) in `tui-monitor-lines.ts`; wire `monitorLeftPaneTreeRows` to budget, FIFO, and post-FIFO sort before returning `unattributedRows`.
- Export `monitorLeftPaneUnattributedSegmentRows` returning `{ heading, bodyRows }` (or equivalent) with `─ Unattributed (N) ─` and `N = bodyRows.length`; wire ink left-pane paint to call it for the unattributed block (heading before body rows).
- Reconcile `tui-monitor-pipeline-tree.test.ts` test `excludes stage-matched and queued runs from unattributed while windowing orphans`: rename/narrow to membership-only (`excludes stage-matched and queued runs from unattributed candidates`); drop `run-stale-orphan` retention expectation from join output; assert stale-orphan survival under budget in the FIFO regression instead.
- Add `tui-monitor-pipeline-tree.test.ts` regression `unattributed segment FIFO retains active runs and drops oldest terminals first` with a fixture that overflows the segment budget via `leftPaneUnattributedBodyRowBudget`; include `// @mutate` directives inverting active retention and oldest-terminal-first eviction (both must turn the regression RED).
- Add `tui-monitor-lines.test.ts` regression `left pane labels unattributed segment with retained run count` asserting `monitorLeftPaneUnattributedSegmentRows` heading text and `N` match post-FIFO body rows (pure monitor-lines derivation, not rendered-ink assertions).
- Preserve existing unattributed candidate membership pins (`isUnattributedCandidate`, stage-matched exclusion, `monitorSelectableNodeIds` pane order).
- Run `bun run typecheck`, `bun run check`, and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first` covers retention ordering and fails against the pre-fix code.
- [ ] `tui-monitor-lines.test.ts` test `left pane labels unattributed segment with retained run count` fails against the pre-fix code.
- [ ] Mutation checkpoint: in `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first`, `// @mutate` directives inverting active retention and oldest-terminal-first eviction both turn that regression RED.
- [ ] `tui-monitor-pipeline-tree.test.ts` membership-only unattributed candidate test stays green for stage-matched and queued exclusion.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the unattributed one-hour / twenty-row live-window entry with brief FIFO within the unattributed segment (active retained; oldest terminal orphans drop first; finishless terminals kept; heading always shown).
- `v2/docs/operator-runbook.md` § Observe — document unattributed segment FIFO and the always-on `─ Unattributed (N) ─` heading; remove one-hour / twenty-row wording for the unattributed segment.
- `v2/spec/tui-overhaul-brief.md` — clear the "no FIFO or labelling polish" gap for unattributed; when all slice-6 siblings are merged, mark slice 6 shipped and note steering, log follow, wait removal, detail windowing, and unattributed FIFO are in-dock.
