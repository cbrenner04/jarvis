# Role-first run rows and branch-labeled ad-hoc rows

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

A run row's label cell leads with the raw `runId` and appends `role:<role>` after it, so the field the operator actually scans — which step of the workflow this is — sits last and truncates first. Ad-hoc top-level rows inherit the same id-first label, naming an invocation id the operator never typed instead of the branch they launched work on.

## Decision ledger

- Every run-kind label leads `<role> <short runId>`, reusing `workflowRoleLabel`'s existing `role:<role>` / `role:<stepId>` / `role:unknown` shapes verbatim. Rules out today's id-first order and rules out a second role formatter here.
- A collapsed workflow row keeps `workflowCollapsedContextSuffix` appended after that head. Rules out dropping the suffix to buy label width — the width rework is `tui-work-row-anatomy`.
- Accepted consequence: head and suffix both name a role, so in the 22-wide label cell a collapsed row's suffix truncates for all but short roles. Rules out suppressing the head on collapsed rows, which would leave the group's identity to a suffix that changes as steps advance.
- An ad-hoc top-level row is labeled with its entry run's `branch`, carried as `label` on `MonitorPipelineTreeAdHocNode` and passed to the cell builder as an explicit override. Rules out deriving ad-hoc-ness from `tableRow.kind` (an ad-hoc `run workflow` invocation is `workflow-collapsed`, exactly like a stage's runs) and from `depth === 0`.
- The override is an optional trailing `labelOverride?: string` on `listMonitorTreeCells` and `listMonitorTreeCellsAtDepth` only. Rules out a required parameter, which churns every existing call site, and rules out threading it through `buildMonitorTreeRow`, which has no ad-hoc caller.
- No blank-`branch` fallback for ad-hoc labels. Rules out a defensive branch for a state admission cannot produce — run admission keys ownership on `project` + `branch`.
- Ad-hoc rows keep painting `branch` in the `branch` column too. Rules out blanking that column for ad-hoc rows, which would strand the value at the widths where the label cell truncates.
- Pipeline, branch, and stage row labels are untouched. Rules out folding the branch-label or stage-label surfaces into this change.
- Assertions run through the pure builders and the injected input hook, not rendered ink frames (`v2/docs/test-writing.md` § TUI test strategy).

## Prerequisites

- Subspec 00 has landed: `shortMonitorId` is exported from `v2/src/tui/tui-shell-layout.ts`.
- `workflowRoleLabel(run)` resolves a run's role from its workflow step, and `workflowCollapsedContextSuffix(members)` supplies the collapsed-group suffix (`v2/src/tui/tui-monitor-workflow-collapse.ts`); both are already imported by `tui-shell-layout.ts`.
- `monitorTreeRun(tableRow)` resolves a `WorkflowTableRow` to its representative `DaemonListRunRow`, which carries `branch` (`v2/src/tui/tui-shell-layout.ts`, `v2/src/daemon/daemon-wire.ts`).
- `buildMonitorPipelineTreeJoin` builds one `MonitorPipelineTreeAdHocNode` per unmatched workflow-invocation group, and `renderTreeRow` paints `run` and `adhoc` nodes through the same `renderRunGridRow` path (`v2/src/tui/tui-monitor-pipeline-tree.ts`, `v2/src/tui/tui-ink-monitor.tsx`).

## Tasks

- `v2/src/tui/tui-shell-layout.ts`:
  - Add `function runRowLabelHead(run: DaemonListRunRow): string` returning the `<workflowRoleLabel> <shortMonitorId(run.runId)>` template literal.
  - Add an optional trailing `labelOverride?: string` parameter to `monitorTreeCellValue`, `listMonitorTreeCells`, and `listMonitorTreeCellsAtDepth`, forwarded down unchanged.
  - Rewrite the `case "label"` block as, in order: `if (labelOverride !== undefined) return labelOverride;` (guard-mutation anchor), `const head = runRowLabelHead(run);` (keystone-mutation anchor), `if (tableRow.kind !== "workflow-collapsed") return head;` (guard-mutation anchor), then a return of `head` concatenated with `workflowCollapsedContextSuffix(tableRow.members)`. Each anchor stays on one physical line.
- `v2/src/tui/tui-monitor-pipeline-tree.ts`: add `label: string` to `MonitorPipelineTreeAdHocNode` and set it to `monitorTreeRun(tableRow).branch` where `buildMonitorPipelineTreeJoin` maps ad-hoc table rows to nodes.
- `v2/src/tui/tui-ink-monitor.tsx`: split `renderTreeRow`'s shared `run`/`adhoc` case so the `adhoc` case forwards `treeRow.label` into `renderRunGridRow` and on to `listMonitorTreeCellsAtDepth`; the `run` case forwards no override.
- Update the existing label expectations in `v2/src/tui/tui-shell-layout.test.ts` — `workflow-child uses indent and role suffix; standalone and collapsed do not`, `workflow-collapsed appends step context suffix in label via listMonitorTreeCells`, and `expanded workflow-child rows render through grid builder alongside collapsed parent` — to the role-first head.
- Tests — add:
  - `v2/src/tui/tui-shell-layout.test.ts` — `a run row leads with its role and follows with the short run id`: a `workflow-child` row whose step role is `actuator` and whose `runId` is UUID-shaped; assert the painted label cell is `role:actuator` followed by a single space and then the id's first eight characters. Carries the keystone `// @mutate`.
  - `v2/src/tui/tui-shell-layout.test.ts` — `a collapsed workflow row keeps its step context suffix after the role-first head`: a `workflow-collapsed` row whose active step role is short enough to leave suffix characters inside the 22-wide cell; assert the cell equals `formatTreeCell(head + workflowCollapsedContextSuffix(members), TREE_COLUMN_WIDTHS.label)` padded, and that it differs from the same head rendered with no suffix. Carries the collapsed-kind guard `// @mutate`.
  - `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an ad-hoc top-level row is labeled with its entry run's branch`: one workflow run matching no stage, on a branch short enough to render whole; assert the ad-hoc node's `label` is that branch and that `listMonitorTreeCellsAtDepth` with the override paints it, not the role-first head. Carries the `labelOverride` guard `// @mutate`.
  - `v2/src/tui/tui-ink-monitor.test.tsx` — `an ad-hoc top-level row paints its entry run's branch as the label`: drive the left pane with one unmatched workflow run and assert the painted ad-hoc row carries the branch text.
- Update `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/spec/tui-command-center-brief.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/tui/tui-shell-layout.test.ts` — `a run row leads with its role and follows with the short run id` asserts a run row's label cell is its role followed by the first eight characters of its run id; it fails against the pre-fix code, which paints the full run id followed by the role.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `a run row leads with its role and follows with the short run id`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-shell-layout.ts "const head = runRowLabelHead(run);" -> "const head = run.runId;"` inside the test body — reverting the label head to the bare run id (baseline semantics) — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `a collapsed workflow row keeps its step context suffix after the role-first head` asserts a collapsed row's label is the role-first head followed by its workflow-step context suffix, distinct from the head alone; it fails against the pre-fix code, which paints the run id followed by that suffix.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `a collapsed workflow row keeps its step context suffix after the role-first head`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-shell-layout.ts "if (tableRow.kind !== \"workflow-collapsed\") return head;" -> "if (tableRow.kind === \"workflow-collapsed\") return head;"` inside the test body — suppressing the suffix on the rows that need it — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an ad-hoc top-level row is labeled with its entry run's branch` asserts an unmatched workflow run's top-level node carries and paints its entry run's branch as the label; it fails against the pre-fix code, which paints the run id.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an ad-hoc top-level row is labeled with its entry run's branch`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-shell-layout.ts "if (labelOverride !== undefined) return labelOverride;" -> "if (labelOverride === \"\") return labelOverride;"` inside the test body — ignoring the ad-hoc label override, so the row falls back to the role-first run label — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `an ad-hoc top-level row paints its entry run's branch as the label` asserts the painted left-pane ad-hoc row carries the branch text, proving the node label reaches the rendered row; it fails against the pre-fix code, which paints the run id.
- [x] Stage row labels are unchanged: the existing `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `the intent stage row appends the split yield only when the artifact lists downstream inputs` stays green.
- [x] Run-row geometry, indent, and the non-label cells are unchanged: the existing `v2/src/tui/tui-shell-layout.test.ts` tests `full-width row length matches the sum of reference column widths`, `unpopulated column slots reserve their defined widths`, and `truncates overflow with ellipsis at column width` stay green, as do the depth-indent tests in `v2/src/tui/tui-monitor-lines.test.ts`.
- [x] `v2/docs/operator-runbook.md` § Observe records that a run row is labeled `<role> <8-character run id>`, that a collapsed workflow row appends its workflow-step context suffix after that head, and that an ad-hoc top-level row is labeled with its entry run's branch.
- [x] `v2/docs/v1-behaviors.md` § TUI / observability records the role-first run label with short run id, the retained collapsed-row context suffix, and the branch-labeled ad-hoc top-level row.
- [x] `v2/spec/tui-command-center-brief.md` seed table row 4 records that seed-slug pipeline identity and role-first run labels shipped from this spec directory while fill-width labels, real indent, and the ▼/▶ glyphs remain outstanding.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — run rows read `<role> <8-character run id>`; collapsed workflow rows keep their workflow-step context suffix after that head; ad-hoc top-level rows are labeled with their entry run's branch.
- `v2/docs/v1-behaviors.md` § TUI / observability — role-first run label with short run id, retained collapsed context suffix, and `MonitorPipelineTreeAdHocNode.label` carrying the entry run's branch into the painted row.
- `v2/spec/tui-command-center-brief.md` — seed table row 4 state: label identity shipped, row anatomy (fill-width, indent, glyphs) still outstanding.
