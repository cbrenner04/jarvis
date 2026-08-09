# Pipeline observation buckets

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Retained snapshots can repeat a pipeline and a fan-out pipeline can expose a reachable undecided approval gate while a sibling keeps its derived state `running`. The dock needs one truthful bucket per pipeline, not a state-only aggregate.

## Decision ledger

- Classify a pipeline observation with any reachable undecided approval gate as `awaiting gate`, even when its derived pipeline state is `running` because a fan-out sibling is running; otherwise classify non-terminal observations as `running`, `succeeded` as `done`, and `failed`/`rejected`/`interrupted` as `failed`. Rules out reading only `snapshot.state` for gates.
- Treat pending pipeline work as `running`; queued daemon work is not a pipeline observation and remains queue-only. Rules out creating a fifth queued dock bucket.
- Deduplicate retained observations by pipeline id with `awaiting gate > running > failed > done` precedence. Rules out double counting cross-daemon overlap and stale terminal evidence hiding live or gated work.
- Expose the bucket result as the pipeline-observation input consumed by dock aggregation; do not format dock metadata or count ad-hoc work in this slice. Rules out coupling classification to presentation.

## Prerequisites

- Pipeline snapshots retain stage/branch records sufficient to identify a reachable undecided approval gate even when `derivePipelineState` reports `running` for a fan-out sibling.
- `mergePipelineSnapshots` concatenates retained per-socket snapshots without pipeline-id deduplication.
- Queued daemon rows are excluded before `buildMonitorPipelineTreeJoin` produces top-level work items.

## Tasks

- Replace `countActivePipelines` in `v2/src/tui/tui-monitor-lines.ts` with a four-bucket pipeline-observation classifier over distinct pipeline ids that detects reachable undecided gates from the snapshot rather than relying only on `snapshot.state`.
- Keep the reachable-gate and pipeline-id precedence decisions on unique guard lines suitable for in-body `// @mutate` directives.
- Update `v2/src/tui/tui-monitor-lines.test.ts` with pipeline-state, fan-out-gate, and contradictory-retained-snapshot cases; place every `// @mutate` directive inside its pinning test body and prove each added or modified classification/precedence guard turns the scoped suite red when inverted.

## Acceptance criteria

- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies every pipeline state into the four dock buckets` asserts `awaiting-approval` only under `awaiting gate`, `pending` and `running` under `running`, `succeeded` under `done`, and `failed`, `rejected`, and `interrupted` under `failed`; it fails against the pre-fix `N active` output.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies a reachable fan-out gate ahead of sibling running work` supplies a pipeline with an undecided reachable approval branch and a running sibling whose derived state is `running`, asserts it counts only under `awaiting gate`, and fails against the pre-fix state-only classification.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies every pipeline state into the four dock buckets` and `classifies a reachable fan-out gate ahead of sibling running work`; Mutation checkpoint: their in-body `// @mutate` directives invert every added pipeline-state and reachable-gate classification guard, and each mutation turns the scoped test RED.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `deduplicates contradictory pipeline snapshots by bucket precedence` supplies repeated ids across retained sockets and asserts each id contributes once in `awaiting gate`, then `running`, then `failed`, then `done` precedence.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `deduplicates contradictory pipeline snapshots by bucket precedence`; Mutation checkpoint: its in-body `// @mutate` directive inverts the duplicate-bucket precedence guard, and the mutation turns the scoped test RED.
- [x] `countActivePipelines` no longer exists under `v2/src/`.

## Documentation updates

- None; dock-level operator documentation belongs to the aggregation slice.
