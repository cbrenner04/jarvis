---
name: tui-unattributed-segment-retention-label
---

# Unattributed segment FIFO retention and count label

## Problem

Unattributed runs appear in the left pane without the FIFO retention rule or segment count label the brief specifies for every segment.

## Decisions

- Apply the left-pane FIFO retention rule to unattributed runs: active never dropped; terminal orphans oldest-by-finish drop first — rules out an unbounded or unlabelled segment.
- Label the segment with a count consistent with the brief (`─ Unattributed (N) ─`) — rules out a bare separator with no cardinality.
- Out of scope: pipeline-tree retention (already shipped) and unattributed candidate membership rules.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first` covers retention ordering and fails against the pre-fix code.
- [ ] `tui-monitor-lines.test.ts` test `left pane labels unattributed segment with retained run count` fails against the pre-fix code.
- [ ] Mutation checkpoint: in `tui-monitor-pipeline-tree.test.ts` test `unattributed segment FIFO retains active runs and drops oldest terminals first`, a `// @mutate` directive inverting the FIFO retention guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark slice 6 shipped; note steering, log follow, wait removal, detail windowing, and unattributed FIFO are in-dock.

## Prerequisites

- Fan-out order: capstone of slice 6; lands after `tui-remove-waitstate-window-detail` or in parallel on `tui-monitor-lines.ts` (disjoint from the steering chain through `tui-dock-log-follow`).
- Left-pane FIFO retention for pipeline trees is shipped.
- `buildMonitorPipelineTreeJoin` and `monitorLeftPaneTreeRows` produce unattributed rows from orphan candidates.
