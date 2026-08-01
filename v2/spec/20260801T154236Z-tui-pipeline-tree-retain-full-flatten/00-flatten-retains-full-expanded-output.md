# Flatten retains full expanded output

`flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed
`maxVisibleRows`, permanently removing terminal pipelines from flatten output. Descend-persisted
expansion grows the tree during `j` walks, so pipelines evicted mid-navigation never return on `k`.

## Problem

Navigation-time expansion inflates the flattened row list past the pane budget; FIFO trimming drops
terminal pipelines from `displayNodes`. Those ids cannot reappear while their expansions remain in
`expandedPipelineNodeIds`, so walking a long tree destroys the top.

## Decisions

- Slice 00 removes all flatten-time `dropOldestTerminalPipeline` trimming from `flattenMonitorPipelineTree` — rules out any FIFO inside flatten (navigation-inflated or idle).
- `flattenMonitorPipelineTree` returns every flattened display node for the current expansion and selection inputs regardless of `maxVisibleRows` overflow.
- `maxVisibleRows` stays on `flattenMonitorPipelineTree` / `buildMonitorPipelineTree` signatures but does not trim flatten output in this slice — rules out removing the parameter before slice 01 defines paint-only use.
- Idle FIFO eviction of unselected, uninvolved terminal pipelines when the operator is not navigating — deferred to slice 01 only (`tui-monitor-scroll-viewport-selectables`).
- Interim full-flatten without paint-only viewport trimming until slice 01 lands — rules out viewport paint slicing in this slice.
- Deferred to slice 01: idle-FIFO trigger and how `maxVisibleRows` participates in paint-only trimming.
- `dropOldestTerminalPipeline` may remain unused until slice 01 idle-FIFO wiring or be removed if lint requires — rules out re-homing idle FIFO into flatten in this slice.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in flatten retention.
- Slice 00 verifies flatten data retention only — end-to-end `j`/`k` reversibility and operator-facing scroll contract are slice 01+02 (behavior) and slice 02 (docs); rules out judging slice 00 incomplete for not fixing entry navigation integration.

## Scope

Slice 00 proves every pipeline id remains in flatten output when expansion exceeds `maxVisibleRows`. Viewport paint slicing, selectable-vs-painted separation, and reversible descend navigation land in slices 01–02.

## Serial handoff

After slice 00 lands, update prerequisites in `v2/spec/ready-intents/tui-monitor-scroll-viewport-selectables.md` and `v2/spec/ready-intents/tui-entry-reversible-descend-navigation.md` before slice 01 plans or runs — both currently assert flatten FIFO-drops when over budget; that becomes false after slice 00.

## Prerequisites

- `flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed `maxVisibleRows`.
- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows with `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Terminal pipelines order oldest-first; active pipelines are never dropped during FIFO trimming.
- Must land before `tui-monitor-scroll-viewport-selectables` and `tui-entry-reversible-descend-navigation`; do not merge slice 02 before slice 01 lands.

## Tasks

- Remove the `flattenMonitorPipelineTree` overflow loop that iteratively calls `dropOldestTerminalPipeline`; return the full flattened list for effective expansion and selection inputs.
- Rename `describe("flattenMonitorPipelineTree viewport FIFO")` to match full-flatten retention (e.g. `flattenMonitorPipelineTree overflow retention`).
- Replace viewport-FIFO pin `iteratively drops oldest terminal pipelines until within maxVisibleRows while retaining actives` with overflow retention regression `expanded tree exceeding maxVisibleRows retains every pipeline id` — reuse the active+terminals fixture (at least one active pipeline); `maxVisibleRows` below flatten row count; every pipeline id present in flatten output.
- Add `Mutation checkpoint:` on the overflow retention pin naming re-enabling flatten-time `dropOldestTerminalPipeline` trimming in `flattenMonitorPipelineTree`; must turn RED if an active pipeline is dropped.
- Reconcile `excludes collapsed pipeline subtrees from maxVisibleRows counting under terminal pressure`: rename and re-pin collapse-only behavior (collapsed subtrees omit descendant rows from flatten output; name and checkpoint must not claim viewport-FIFO or `maxVisibleRows` budget semantics); update mutation checkpoint accordingly.
- Reconcile `tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured terminal size`: replace `initialTreeRows.length <= maxVisibleRows` and trimmed-pipeline-count pins with post-slice-00 expectations — full flatten exceeds pane budget (`initialTreeRows.length > maxVisibleRows` or equivalent) and every pipeline id appears in tree/flatten row ids (no pipelines dropped from flatten output); `assertSelectionPainted` and navigation pins stay green.
- Update `v2/docs/v1-behaviors.md`: flatten no longer FIFO-trims; interim full-flatten until slice 01 viewport paint; soften the descend-eviction caveat for this interim state.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — `expanded tree exceeding maxVisibleRows retains every pipeline id` (active+terminals fixture) fails pre-fix when FIFO drops terminals during overflow and passes after; every pipeline id present in flatten output.
- [ ] `tui-monitor-pipeline-tree.test.ts` — mutating `flattenMonitorPipelineTree` to re-enable flatten-time `dropOldestTerminalPipeline` trimming turns the overflow retention pin RED; `Mutation checkpoint:` names that inversion and covers active-pipeline drop.
- [ ] `tui-monitor-pipeline-tree.test.ts` — reconciled collapsed-subtree pin names and asserts collapse-only row omission (not viewport-FIFO or `maxVisibleRows` budget semantics); not a false-green carryover of FIFO behavior.
- [ ] `tui-monitor-pipeline-tree.test.ts` — overflow-retention `describe` block renamed from `viewport FIFO`; `flattenMonitorPipelineTree collapse`, `flattenMonitorPipelineTree reveal-on-select`, and `flattenMonitorPipelineTree ordering` pins stay green.
- [ ] `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured terminal size` asserts full flatten exceeds pane budget and no pipelines are dropped from flatten output (post-slice-00 expectations above).
- [ ] `v2/docs/v1-behaviors.md` — documents interim full-flatten (flatten no longer FIFO-trims until slice 01 viewport paint).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — flatten no longer FIFO-trims at navigation time; interim full-flatten until slice 01 viewport paint. Operator-facing scroll contract still ships slice 02.
