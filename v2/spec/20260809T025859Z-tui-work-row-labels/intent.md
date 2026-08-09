---
name: tui-work-row-labels
---

# TUI work-row labels — seed-slug pipeline identity, role-first run rows

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on the unified work tree.

## Problem

Every pipeline row is labeled `snapshot.name` — the registry definition name (`full-review`) — so a pane full of pipelines is a column of identical labels and the operator has to open the detail pane to learn which seed a row is. `seedPath` is already on `PipelineSnapshot` and already renders in the detail pane; the tree just doesn't read it. Run rows lead with the raw `runId` and append `role:<role>` after it, so the field the operator scans for is last. Ad-hoc top-level rows inherit that same id-first label.

## Decisions

- Pipeline label = `seedPath` basename with its extension stripped. Rules out the definition name, identical across every pipeline of one definition.
- No `seedPath` (text-seeded admission) falls back to definition name + short `pipelineId`. Rules out a bare definition name, which still collides across concurrent text-seeded pipelines.
- Short id = the leading 8 characters of the UUID. Rules out rendering 36-char UUIDs in a label cell.
- Run label leads with the role and follows with the short `runId`. Rules out today's id-first order.
- Ad-hoc top-level row = its entry run's branch. Rules out the representative run id, which names an invocation the operator never typed.
- Stage and branch labels are untouched here (`stageId`; branch label stripping belongs to the branch subtree).
- The fixed column grid stays in place; labels still render in the existing label cell and still truncate at its width. Rules out bundling the width rework, which lands separately.

## Acceptance criteria

- [ ] A pipeline admitted with a file seed labels its row with the seed basename sans extension; two pipelines of the same definition from different seeds render distinguishable rows. Fails against pre-fix code, which renders the definition name for both.
- [ ] A pipeline with no recorded `seedPath` labels its row with the definition name plus the short `pipelineId`, so two text-seeded pipelines of one definition stay distinguishable.
- [ ] A run row reads role first, then short `runId`; a collapsed workflow row keeps its existing context suffix.
- [ ] An ad-hoc top-level row is labeled with its entry run's branch.
- [ ] Stage row labels are unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — what identifies each row kind in the left pane, and the text-seeded fallback label.
- `v2/docs/v1-behaviors.md` § TUI / observability — pipeline rows carry seed identity, run rows are role-first, ad-hoc rows carry the entry run's branch.

## Prerequisites

- `projectPipelineSnapshot` projects `seedPath` onto `PipelineSnapshot` when admission recorded a file seed, and omits it otherwise (`v2/src/daemon/pipeline-observation.ts`).
- Ad-hoc workflow invocations render as top-level work-tree nodes carrying their `WorkflowTableRow` in the same flatten as pipelines.
- `workflowRoleLabel` derives a run's role from its workflow step, and `workflowCollapsedContextSuffix` supplies the collapsed-group suffix (`v2/src/tui/tui-monitor-workflow-collapse.ts`).
- `monitorTreeRun` resolves a `WorkflowTableRow` to its representative `DaemonListRunRow`, which carries `branch` (`v2/src/tui/tui-shell-layout.ts`).
