---
name: tui-intent-branch-subtree
---

# Branch-grouped pipeline subtree with dead rows elided

Single surface — the work-tree model in `v2/src/tui/tui-monitor-pipeline-tree.ts` plus its immediate paint and right-pane consumers; no daemon, persistence, or CLI change, so there is no second surface to split off.

## Problem

After an intent split the tree lists stages in position order with branches interleaved (`intent`, `approve-intent` ×4, `plan` ×4, …), so a 3-branch full-review is ~20 rows and the operator cannot see "this seed split into 3 intents, here is each intent's progress" — dogfooding showed the operator initially could not tell the rows were one seed split into three. Two row classes are pure noise: post-split `default` placeholders (`admitFanOutBranches` writes `skipped` to every one) and satisfied gates (`approved`/`skipped` approval rows with no elapsed).

## Decisions

- Pipeline subtree: pre-split stages inline under the pipeline, then one branch node per fan-out `branchKey`, each holding that branch's post-split stages in position order. Rules out flat stage-position ordering.
- Fan-out is derived from the snapshot: the branch keys are the distinct non-`default` `branchKey`s and a stage is post-split when its `position` is at or above the lowest position carrying one. Rules out a new split marker on the `pipeline_list` wire.
- Branch node id is `pipelineId` + `branchKey`; stage node ids keep `monitorPipelineStageNodeId`. Rules out re-keying stage nodes under the branch, which would drop a live selection on the refresh that introduces the branch level.
- Branch nodes are expandable and reveal-on-select expands pipeline and branch ancestors only. Rules out expanding sibling branches.
- Branch label strips the longest `-`-bounded prefix shared by ≥2 sibling branch keys (`tui-pipeline-list-poll|tree-model|tree-monitor` → `list-poll`, `tree-model`, `tree-monitor`); the full key stays in the detail pane. Rules out 14 chars of shared prefix as the only branch signal.
- Branch summary is the branch's current stage + status: first post-split stage in position order whose record is not satisfied; all satisfied → the last stage's status. Rules out a single rolled-up status word with no stage name.
- Satisfied here means `succeeded`, `approved`, or `skipped`. Rules out reusing `isAuthoredStageSatisfied`, which excludes `skipped` and would park a skip-settled branch's summary on a stage that will never move.
- Post-split `default` placeholder rows never render; pre-split stages, which also run on `default`, still do. Rules out filtering every `default` row.
- Gate rows render only when `awaiting` or `rejected`; `approved` and `skipped` gates leave the tree with their outcome implied by the next stage, and their records stay in the detail pane. Rules out inert decision rows.
- Stage kind comes from the pipeline definition resolved by `snapshot.name` through `getPipelineDefinition`. Rules out adding `kind` to the wire, and rules out inferring gate-ness from status alone — a skip-settled workflow stage and a skipped gate are both `skipped`.
- The intent stage row appends `→ N intents` when its artifact carries `downstreamInputs`. Rules out leaving the split visible only as one-line artifact JSON in the detail pane.
- The right pane resolves a selected stage's snapshot record by `stageId` + `branchKey`. Rules out today's positional `pipeline.stages.indexOf` lookup, which grouping and elision silently desynchronize into wrong-stage detail.
- A selected branch node renders pipeline context plus the full `branchKey`; branch-grouped detail roll-up stays with `tui-detail-pane-structure`.
- A pipeline with no fan-out renders as today: stages inline, no branch level. Rules out a synthetic single `default` branch node.

## Acceptance criteria

- [ ] A fanned-out pipeline flattens to pre-split stages then one node per branch holding that branch's post-split stages in position order; a `tui-monitor-pipeline-tree.test.ts` test naming that shape fails against the pre-fix code, which interleaves branches in flat position order.
- [ ] Post-split `default` placeholder rows are absent from the flattened tree while pre-split stages on `default` still render.
- [ ] A gate row renders when `awaiting` or `rejected` and is absent when `approved` or `skipped`; a post-split workflow stage that settled `skipped` still renders.
- [ ] Branch labels strip the longest `-`-bounded prefix shared by ≥2 siblings; a lone branch, or siblings with no shared prefix, render the full key.
- [ ] A mid-flight branch summarizes as its first unsatisfied stage and that stage's status, a fully satisfied branch as its last stage's status, and a branch parked on a rejected gate as that gate.
- [ ] Selecting a run under a branch expands that pipeline and that branch only, leaving sibling branches collapsed, and `e` toggles a branch node.
- [ ] The intent stage row appends `→ N intents` when its artifact lists N downstream inputs and appends nothing when it does not.
- [ ] Right-pane detail for a stage selected under a branch is that stage's own record; a `tui-monitor-lines.test.ts` test fails against the pre-fix positional lookup.
- [ ] A pipeline with no fan-out keeps pipeline → stage → run nesting with no branch level: `nests a run whose workflow invocation matches a stage under that stage` and `selecting a descendant expands ancestors only and leaves sibling pipelines collapsed` (`tui-monitor-pipeline-tree.test.ts`) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — branch-grouped pipeline subtree, stripped branch labels and where the full key lives, the branch summary rule, which rows are elided (post-split `default` placeholders, satisfied gates) and that their records remain in the detail pane, and the `→ N intents` yield on the intent row.
- `v2/docs/v1-behaviors.md` § TUI / observability — pipeline-tree bullet: the branch level and its node id, the elision rules, the summary derivation, stage kind resolved from the registry definition, and right-pane stage detail now keyed by `stageId` + `branchKey`; `e`/navigation bullet: branch nodes are expandable and reveal-on-select stops at the branch.
- `v2/spec/tui-command-center-brief.md` — seed table row 3 state.

## Prerequisites

- The left pane is one flattened work tree whose top-level nodes are pipelines and ad-hoc work items, painted from a single node list with no unattributed segment.
- `pipeline_list` projects each stage record onto `PipelineSnapshot` with `stageId`, `branchKey`, `position`, `status`, `artifact`, `startedAt`, and `endedAt`.
- A pipeline snapshot's `name` is its registry definition name, and that name resolves to the authored stages carrying `kind: "workflow"` or `kind: "approval"`.
- Fan-out admits one branch per intent-artifact `downstreamInputs` entry, keyed by the entry's basename, and writes `skipped` to every post-split `default` placeholder record.
- Approval stage records carry `awaiting`, `approved`, or `rejected`, and a decision moves an `awaiting` record to `approved` or `rejected`.
- Expansion is keyed by node id: a node id is admitted for `e`, and selecting a node expands its ancestors.
- The right pane resolves the selected row from the full tree row list and renders pipeline context plus the selected stage's record.
