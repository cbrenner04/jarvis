# Three-bucket top-level ordering

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`orderPipelineNodes` (`v2/src/tui/tui-monitor-pipeline-tree.ts`) splits top-level rows into two buckets: non-terminal by `createdAt` ascending, then terminal by finish ascending. A pipeline parked at a gate for days ranks inline with running work. The terminal block puts the oldest finish nearest the tree and pushes the newest toward the bottom of the pane. Terminality is read off `finishedAtMs !== null`, so a terminal-state item with no finish stamp is bucketed as active, and the `?? 0` fallback in the terminal comparison is unreachable epoch coercion.

## Decision ledger

- Top-level rank is running (0) → gated (1) → terminal (2), painted in that order. Rules out the current two-bucket active/terminal split.
- Terminality comes from the item's derived state (`isPipelineTerminal(snapshot.state)`), not from `finishedAtMs !== null`. Rules out keeping finish-timestamp classification, which buckets a finishless terminal with running work.
- Gated means derived pipeline state `awaiting-approval`. Rules out re-deriving the gate by scanning stage records for `awaiting`.
- Running is "neither terminal nor gated", so `pending` pipelines ride in the running bucket. Rules out a fourth bucket for admitted-but-not-yet-running work.
- Running and gated buckets both sort `createdAt` ascending, oldest highest. Rules out newest-first for live work and rules out leaving the gated bucket in snapshot order (merged multi-socket snapshot order is arbitrary).
- Terminal bucket sorts `finishedAtMs ?? createdAt` descending. Rules out the `?? 0` epoch coercion and the current oldest-finish-first order.
- The `createdAt` fallback is a comparator key only; no rendered elapsed or finish cell changes. Rules out display-side invention of a finish time — the data fix is the `pipeline-terminal-timestamps` seed.
- The comparator takes per-item derived keys — `running`, `gated`, `finishedAtMs`, `createdAt` — with a separate pipeline-node key deriver, rather than reading `PipelineSnapshot` fields. Rules out a snapshot-shaped comparator that has to be rewritten when ad-hoc invocations become top-level nodes.
- Deferred to first consumer: how a non-pipeline top-level item derives its `running` / `gated` keys — pin when a caller adds one.
- Ordering is asserted through `flattenMonitorPipelineTree` output, not rendered ink (`v2/docs/test-writing.md` § TUI test strategy). Rules out an ink-frame assertion that goes local-green / CI-red.
- Out of scope: unattributed-segment membership, retention, and selection (its `v1-behaviors.md` retention sort sentence — actives by earliest `createdAt`, terminals oldest finish first — stays as written); ordering of stages and runs within a pipeline.

## Prerequisites

- `buildMonitorPipelineTreeJoin` builds top-level pipeline nodes from merged daemon `pipeline_list` snapshots (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- `PipelineSnapshot` carries `state`, `createdAt`, and `finishedAtMs` (`v2/src/daemon/pipeline-observation.ts`).
- `awaiting-approval` is a `PipelineDerivedState` value produced by `derivePipelineState`; `isPipelineTerminal` classifies the terminal set (`v2/src/daemon/pipeline-execution.ts`).
- `flattenMonitorPipelineTree` emits the whole tree (its `_maxVisibleRows` is unused) and the left pane scrolls a viewport over it, so top-level order is not truncated by pane height.

## Tasks

- In `v2/src/tui/tui-monitor-pipeline-tree.ts`, replace `orderPipelineNodes`/`isTerminalPipelineNode` with a derived-key comparator: a key type (`running`, `gated`, `finishedAtMs`, `createdAt`), a pipeline-node key deriver reading `snapshot.state` through `isPipelineTerminal`, a rank function, and rank-then-tiebreak comparison (`createdAt` ascending for running/gated, `finishedAtMs ?? createdAt` descending for terminal).
- Add the three regressions to `v2/src/tui/tui-monitor-pipeline-tree.test.ts` under the titles named in the acceptance criteria; fold the superseded `orders active pipelines above terminals by createdAt then finishedAtMs` test into them.
- Carry the guard `// @mutate` directive (collapse the gated rank into the running rank) and the keystone `// @mutate` directive (revert the terminal comparison to ascending finish) inside their pinning test bodies, each anchored on a uniquely occurring line of landed code.
- Update terminal-order expectations in existing tests: `expanded tree exceeding maxVisibleRows retains every pipeline id` and `omits collapsed pipeline descendant rows from flatten output` (`v2/src/tui/tui-monitor-pipeline-tree.test.ts`), and `aligns selectable node ids with left-pane tree rows for the measured terminal size` (`v2/src/tui/tui-entry.test.tsx`, whose overflow fixture is all-terminal with ascending finish, so painted order is now the reverse of the fixture array).
- Update `v2/docs/operator-runbook.md` § Observe and the TUI pipeline-tree bullet in `v2/docs/v1-behaviors.md` § TUI / observability.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `top-level rows order running before gated before terminal` pins a running, an `awaiting-approval`, and a terminal pipeline in one snapshot set and asserts that painted top-level order; fails against the pre-fix code, which sorts the gated pipeline by `createdAt` among non-terminals.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `terminal rows order newest finish first` asserts two finish-stamped terminals paint newest finish nearest the fold; fails against the pre-fix code, which orders terminals oldest finish first.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a finishless terminal row sorts by createdAt among terminals` pins a terminal-state snapshot with `finishedAtMs: null` landing between two finish-stamped terminals by its `createdAt`; fails against the pre-fix code, which classifies it non-terminal and sorts it above every terminal.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `top-level rows order running before gated before terminal`; Mutation checkpoint: its pinning test carries a `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts` directive collapsing the gated rank into the running rank at a uniquely occurring anchor in landed code, and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `terminal rows order newest finish first`; Keystone checkpoint: its pinning test carries a `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts` directive reverting the terminal comparison to ascending finish (baseline semantics) at a uniquely occurring anchor in landed code, and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` `expanded tree exceeding maxVisibleRows retains every pipeline id` and `omits collapsed pipeline descendant rows from flatten output`, and `v2/src/tui/tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured terminal size`, stay green with their terminal expectations updated to newest-finish-first — pipeline membership, retention, expansion, and selection are unchanged by the reorder.
- [ ] `v2/docs/operator-runbook.md` § Observe states the top-level order: running → awaiting gate → terminal, terminals newest finish first, finishless terminals by `createdAt`.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records the three-bucket top-level order and the finishless-terminal `createdAt` fallback on the TUI pipeline-tree bullet.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — top-level tree order: running → awaiting gate → terminal; running and gated by `createdAt` ascending; terminals newest finish first; a terminal row with no finish stamp orders by `createdAt` among terminals.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the three-bucket top-level order and the finishless-terminal `createdAt` fallback on the TUI pipeline-tree bullet; leave the unattributed-segment retention sort sentence unchanged.
