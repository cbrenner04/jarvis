# Dock work-status counts

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The dock reports one retained-pipeline `N active` aggregate. Awaiting approval is indistinguishable from running work, terminal outcomes are invisible, and ad-hoc workflow invocations are omitted even though they are top-level work-tree items.

## Decision ledger

- Replace `N active` with `N running · N awaiting gate · N failed · N done`; do not retain the aggregate beside it. Rules out preserving the ambiguous headline as a fifth count.
- Count one top-level item per distinct pipeline id and per ad-hoc node produced by the existing workflow-invocation collapse; a standalone ad-hoc row remains one degenerate group. Rules out counting retained observations, stages, or workflow constituent runs.
- Classify `awaiting-approval` pipelines as `awaiting gate`, other non-terminal pipelines as `running`, `succeeded` as `done`, and `failed`/`rejected`/`interrupted` as `failed`. Rules out status-specific terminal buckets and treating pending work as idle.
- Classify an ad-hoc group as `running` while any member is non-terminal, otherwise use the existing workflow rollup: `completed` is `done` and every other terminal rollup is `failed`. Rules out inventing an ad-hoc gate state or trusting only the representative run.
- Deduplicate pipeline observations by id with `awaiting gate > running > failed > done` precedence. Rules out double counting cross-daemon overlap and stale terminal evidence hiding live or gated work.
- Keep all four counts before `profile@digest`, refresh, and feedback in the composed status string. Rules out right truncation hiding the primary status first.
- Leave the left-pane tree, ordering, and selection unchanged. Rules out coupling dock aggregation to the pinned tree segment.

## Prerequisites

- `buildMonitorPipelineTreeJoin` emits pipelines and collapsed ad-hoc workflow groups as top-level nodes; standalone runs degenerate to one ad-hoc node.
- `adHocNodeOrderKey` ranks an ad-hoc group as running while any member is non-terminal and otherwise terminal, never gated.
- `derivePipelineState` emits `awaiting-approval` only for a reachable undecided approval stage and distinguishes `succeeded`, `failed`, `rejected`, and `interrupted` terminal states.
- `workflowGroupHasActiveMember` and `workflowGroupRollupRunStatus` distinguish live groups from fully terminal completed or unsuccessful groups.
- `mergePipelineSnapshots` concatenates retained per-socket snapshots without pipeline-id deduplication.
- `monitorDockLines` composes `dockStatusLine(state)` before passing it to `fitDockRow` for right truncation.

## Tasks

- Replace `countActivePipelines` in `v2/src/tui/tui-monitor-lines.ts` with four-bucket dock aggregation over distinct pipeline ids plus the ad-hoc nodes from the existing tree join; reuse `workflowTableRowMembers`, `workflowGroupHasActiveMember`, and `workflowGroupRollupRunStatus` for ad-hoc classification.
- Keep pipeline-id precedence on one unique guard line suitable for the required source mutation; keep pipeline and ad-hoc classification decisions on unique lines suitable for in-body `// @mutate` directives.
- Compose the status prefix as `<running> running · <awaiting> awaiting gate · <failed> failed · <done> done · <profile>@<digest> · refresh <interval>` before existing error/result suffixes and display-width truncation.
- Update `v2/src/tui/tui-monitor-lines.test.ts` with the named headline, classification, ad-hoc rollup, and contradictory-snapshot cases; place every `// @mutate` directive inside its pinning test body and prove each added or modified classification/precedence guard turns the scoped suite red when inverted.
- Update `v2/src/tui/tui-ink-monitor.test.tsx` expectations that pin the old dock prefix; do not change left-pane behavior or its tests.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `renders running and awaiting-gate counts before dock metadata` uses one `awaiting-approval` and one running pipeline, asserts `1 running · 1 awaiting gate · 0 failed · 0 done` precedes `profile@digest`, remains the leftmost prefix under narrow right truncation, and fails against the pre-fix `2 active` output.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `renders running and awaiting-gate counts before dock metadata`; Keystone checkpoint: its test body carries a `// @mutate` directive that replaces the four-count status template with the baseline non-terminal `N active` template, and the mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies every pipeline state into the four dock buckets` asserts `awaiting-approval` only under `awaiting gate`, `pending` and `running` under `running`, `succeeded` under `done`, and `failed`, `rejected`, and `interrupted` under `failed`.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies every pipeline state into the four dock buckets`; Mutation checkpoint: its in-body `// @mutate` directives invert every added pipeline-classification guard, and each mutation turns the scoped test RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies ad-hoc workflow groups through their terminal rollup` asserts one count for a multi-run invocation, `running` while any member is non-terminal, `done` when every durable step completes, and `failed` when every member is terminal but the rollup is not completed; no case contributes to `awaiting gate`.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies ad-hoc workflow groups through their terminal rollup`; Mutation checkpoint: its in-body `// @mutate` directives invert every added ad-hoc active/terminal-success classification guard, and each mutation turns the scoped test RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `deduplicates contradictory pipeline snapshots by bucket precedence` supplies repeated ids across retained sockets and asserts each id contributes once in `awaiting gate`, then `running`, then `failed`, then `done` precedence.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `deduplicates contradictory pipeline snapshots by bucket precedence`; Mutation checkpoint: its in-body `// @mutate` directive inverts the duplicate-bucket precedence guard, and the mutation turns the scoped test RED.
- [ ] `countActivePipelines` no longer exists under `v2/src/`; `v2/src/tui/tui-ink-monitor.test.tsx` pins the four-count dock prefix instead of `N active`.
- [ ] Left-pane behavior is unchanged: `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `ad-hoc work items order among pipelines by rank then finish` and `top-level rows order running before gated before terminal` stay green without expectation changes.
- [ ] `v2/docs/operator-runbook.md` § Observe defines the four dock counts, ad-hoc group coverage, pipeline-id deduplication and precedence, and their leftmost placement before metadata and feedback.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records the `N active` replacement and pipeline/ad-hoc per-item classification, including retained-observation precedence.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — define `running`, `awaiting gate`, `failed`, and `done`; include ad-hoc workflow groups, retained pipeline-id deduplication precedence, and leftmost truncation priority.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the four-count status-line replacement and per-item pipeline/ad-hoc classification.
