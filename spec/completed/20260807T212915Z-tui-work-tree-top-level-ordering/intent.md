---
name: tui-work-tree-top-level-ordering
---

# Top-level work-tree ordering: running, gated, terminal

## Problem

`orderPipelineNodes` splits top-level rows into two buckets: non-terminal by `createdAt` ascending, then terminal by finish ascending. Pipelines parked at a gate for days rank alongside running work with nothing separating them. The terminal block puts the oldest finish nearest the tree and pushes the newest toward the bottom of the pane. A terminal pipeline whose `finishedAtMs` is `null` coerces to `0` and sorts ahead of every real finish.

## Decisions

- Three top-level buckets in painted order: running → awaiting a gate → terminal. Rules out the current two-bucket active/terminal sort.
- An item is gated when its derived pipeline state is `awaiting-approval`. Rules out re-deriving the gate by scanning stage records for `awaiting`.
- Running bucket sorts `createdAt` ascending, oldest work highest. Rules out newest-first for live work.
- Terminal bucket sorts finish descending, newest nearest the fold. Rules out the current oldest-finish-first order.
- A terminal item with no finish timestamp sorts by `createdAt` within terminals. Rules out the `?? 0` epoch coercion and any display-side invention of a finish time; the data fix is `pipeline-terminal-timestamps`.
- The comparator reads per-item derived keys — has-running-member, gated, finish, `createdAt` — rather than `PipelineSnapshot` fields directly, so non-pipeline top-level items can be ordered by the same rule. Rules out a snapshot-shaped comparator that has to be rewritten when ad-hoc items become top-level nodes.
- Out of scope: unattributed-segment membership, retention, and selection; ordering of stages and runs within a pipeline.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` test `top-level rows order running before gated before terminal` pins a running, an `awaiting-approval`, and a terminal pipeline in one snapshot set and fails against the pre-fix code.
- [ ] `tui-monitor-pipeline-tree.test.ts` test `terminal rows order newest finish first` fails against the pre-fix code, which orders terminals oldest finish first.
- [ ] `tui-monitor-pipeline-tree.test.ts` test `a finishless terminal row sorts by createdAt among terminals` fails against the pre-fix code, which sorts it ahead of every finish-stamped terminal.
- [ ] Mutation checkpoint: in `tui-monitor-pipeline-tree.test.ts` test `top-level rows order running before gated before terminal`, a `// @mutate` directive collapsing the gated bucket into the running bucket turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. Ordering is proven through the pure tree builder, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — state the top-level order: running → awaiting gate → terminal, terminals newest finish first, finishless terminals by `createdAt`.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the three-bucket top-level order and the finishless-terminal fallback.

## Prerequisites

- `buildMonitorPipelineTreeJoin` builds top-level pipeline nodes from merged daemon `pipeline_list` snapshots.
- `PipelineSnapshot` carries `state`, `createdAt`, and `finishedAtMs`.
- `awaiting-approval` is a value of the derived pipeline state produced by `derivePipelineState`.
- The left pane flattens the whole tree and scrolls a viewport over it, so top-level order is not truncated by pane height.
