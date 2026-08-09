# Dock work-status aggregation

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The dock must render the classified pipeline observations together with genuine ad-hoc workflow work, without counting queue-only rows or stage-matched workflow invocations twice.

## Decision ledger

- Render `N running · N awaiting gate · N failed · N done`; do not retain `N active` beside it. Rules out preserving the ambiguous headline as a fifth count.
- Count one top-level work item per classified pipeline id and per ad-hoc node from the existing workflow-invocation collapse; a standalone ad-hoc row is one degenerate group. Rules out counting stages, constituent runs, or a pipeline-matched invocation again as ad-hoc.
- Classify an ad-hoc group as `running` when it has active members or its existing rollup is non-terminal, including durable terminal-looking rows with hidden live activity; only a fully terminal rollup is `done` when completed or `failed` otherwise. Ad-hoc work is never `awaiting gate`. Rules out trusting a representative row or treating a paused/blocked run as an approval gate.
- Queued work remains in the Queue section only and contributes to none of the four dock counts. Rules out treating every non-terminal daemon row as active work.
- Keep all four counts before `profile@digest`, refresh, and feedback in the composed status string. Rules out right truncation hiding the primary status first.
- Leave the left-pane tree, ordering, and selection unchanged. Rules out coupling dock aggregation to the pinned tree segment.

## Prerequisites

- The pipeline-observation buckets in `00-pipeline-observation-buckets.md` provide one precedence-resolved bucket per pipeline id.
- `buildMonitorPipelineTreeJoin` emits collapsed ad-hoc workflow groups, omits queued runs, and excludes invocations matched to pipeline stages.
- `workflowTableRowMembers`, `workflowGroupHasActiveMember`, and `workflowGroupRollupRunStatus` distinguish group members, hidden liveness, and terminal rollups.
- `monitorDockLines` composes `dockStatusLine(state)` before passing it to `fitDockRow` for right truncation.

## Tasks

- Aggregate the pipeline-observation buckets with ad-hoc nodes from `buildMonitorPipelineTreeJoin` in `v2/src/tui/tui-monitor-lines.ts`; reuse `workflowTableRowMembers`, `workflowGroupHasActiveMember`, and `workflowGroupRollupRunStatus` for ad-hoc classification.
- Keep the ad-hoc active/non-terminal-rollup and terminal-success decisions on unique guard lines suitable for in-body `// @mutate` directives.
- Compose the status prefix as `<running> running · <awaiting> awaiting gate · <failed> failed · <done> done · <profile>@<digest> · refresh <interval>` before existing error/result suffixes and display-width truncation.
- Update `v2/src/tui/tui-monitor-lines.test.ts` with the named headline, ad-hoc rollup, queue-only, matched-invocation, and standalone-row cases; place every `// @mutate` directive inside its pinning test body and prove each added or modified ad-hoc classification guard turns the scoped suite red when inverted.
- Update `v2/src/tui/tui-ink-monitor.test.tsx` expectations that pin the old dock prefix; do not change left-pane behavior or its tests.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `renders running and awaiting-gate counts before dock metadata` uses one parked and one running pipeline, asserts `1 running · 1 awaiting gate · 0 failed · 0 done` precedes `profile@digest`, remains the leftmost prefix under narrow right truncation, and fails against the pre-fix `2 active` output.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `renders running and awaiting-gate counts before dock metadata`; Keystone checkpoint: its test body carries a `// @mutate` directive that replaces the four-count status template with the baseline non-terminal `N active` template, and the mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies ad-hoc workflow groups through their terminal rollup` asserts one count for a multi-run invocation, `running` when a member is active or the existing rollup remains non-terminal despite terminal-looking durable rows, `done` when every member is terminal and the rollup is completed, and `failed` for every other fully terminal rollup; no case contributes to `awaiting gate`.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `classifies ad-hoc workflow groups through their terminal rollup`; Mutation checkpoint: its in-body `// @mutate` directives invert every added ad-hoc active/non-terminal-rollup and terminal-success classification guard, and each mutation turns the scoped test RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `counts genuine ad-hoc invocations once without duplicating matched pipeline work` supplies one pipeline with a matched workflow invocation and one unmatched invocation, asserts only the unmatched invocation contributes as ad-hoc, and fails against aggregation that counts both invocations.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `counts standalone ad-hoc rows as degenerate groups` supplies a non-workflow standalone row and asserts it contributes once through the same running/done/failed rules; it fails against aggregation that counts only collapsed workflow groups.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `keeps queued work out of dock counts` supplies queued work beside a top-level work item, asserts the queued row remains Queue-only and contributes to none of `running`, `awaiting gate`, `failed`, or `done`, and fails against aggregation that treats it as a non-terminal work item.
- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` pins the four-count dock prefix instead of `N active`.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `ad-hoc work items order among pipelines by rank then finish` and `top-level rows order running before gated before terminal` stay green without expectation changes.
- [ ] `v2/docs/operator-runbook.md` § Observe defines the four dock counts, ad-hoc group coverage, queue-only exclusion, pipeline-id deduplication and precedence, and their leftmost placement before metadata and feedback.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records the `N active` replacement and per-item pipeline/ad-hoc classification, including retained-observation precedence and queue-only exclusion.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — define `running`, `awaiting gate`, `failed`, and `done`; include ad-hoc workflow groups, queue-only exclusion, retained pipeline-id deduplication precedence, and leftmost truncation priority.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the four-count status-line replacement and per-item pipeline/ad-hoc classification, including queue-only exclusion.
