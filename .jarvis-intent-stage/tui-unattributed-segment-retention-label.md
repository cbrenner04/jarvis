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

- [ ] Unattributed segment applies FIFO retention (active shown always; terminals oldest-by-finish drop first); a pure-function test covers the retention ordering.
- [ ] The left pane labels the unattributed segment with its retained run count.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

None — the brief already documents segment FIFO; this intent aligns unattributed with shipped pipeline retention.

## Prerequisites

- Left-pane FIFO retention for pipeline trees is shipped.
- `buildMonitorPipelineTreeJoin` and `monitorLeftPaneTreeRows` produce unattributed rows from orphan candidates.
