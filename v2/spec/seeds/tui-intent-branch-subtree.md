---
name: tui-intent-branch-subtree
---

# TUI intent-branch subtree — group pipeline stages by intent, kill dead rows

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on the unified work tree (`tui-unified-work-tree`). Row appearance stays with `tui-work-row-anatomy`; detail-pane grouping stays with `tui-detail-pane-structure`.

## Problem

After an intent split, the tree lists stages in position order with branches interleaved (`intent`, `approve-intent` ×4, `plan` ×4, …), so a 3-branch full-review is ~20 rows and the operator cannot see "this seed split into 3 intents, here is each intent's progress". Dogfooding showed the operator initially could not tell the rows were one seed split into three. Two row classes are pure noise: post-split `default`-branch placeholders (always `skipped`, one per post-split stage) and satisfied gates (`approved`/`skipped` approval rows with no elapsed).

## Decisions

- Pipeline subtree: pre-split stages inline under the pipeline, then one branch node per fan-out `branchKey`, each containing that branch's post-split stages in position order. Rules out flat stage-position ordering.
- Branch node id = `pipelineId + branchKey`; stage node ids unchanged. Branch nodes are expandable; reveal-on-select expands ancestors through the branch level.
- Branch label strips the longest common prefix shared by ≥2 sibling branch keys, cut at a `-` boundary (`tui-pipeline-list-poll|tree-model|tree-monitor` → `list-poll`, `tree-model`, `tree-monitor`); full key in the detail pane. Rules out 14 chars of shared prefix as the only branch signal.
- Branch node state summary = the branch's current stage + status: first stage in position order whose record is not satisfied (`succeeded`/`approved`/`skipped`); all satisfied → last stage's status.
- Post-split `default`-branch placeholder rows never render in the tree. Rules out useless rows.
- Gate stage rows render only when `awaiting` or `rejected`; `approved`/`skipped` gates are elided from the tree (outcome implied by the next stage; full records remain on the detail pane). Rules out inert decision rows.
- The intent stage row shows its yield when the artifact carries `downstreamInputs`: `→ N intents`.
- Pipelines without a fan-out render as today (stages inline, no branch level).

## Acceptance criteria

- [ ] A fanned-out pipeline flattens to pre-split stages then per-branch nodes with their post-split stages; a non-fanned pipeline is unchanged.
- [ ] Post-split `default` placeholder rows are absent from the flattened tree; pre-split stages (which run on `default`) still render.
- [ ] A gate row renders when `awaiting` or `rejected` and is absent when `approved` or `skipped`.
- [ ] Branch labels: common prefix stripped at a `-` boundary when ≥2 siblings share it; no stripping for a single branch or no shared prefix.
- [ ] Branch summary pins: mid-flight branch shows its current stage + status; fully satisfied branch shows the last stage's status; rejected gate shows that gate.
- [ ] Selecting a run under a branch expands pipeline and branch ancestors only (siblings collapsed); `e` toggles branch nodes.
- [ ] Intent stage row appends `→ N intents` when its artifact lists N downstream inputs.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — branch-grouped pipeline subtree; which rows are elided and where the full records live.

## Prerequisites

- `v2/src/tui/tui-monitor-pipeline-tree.ts` — `buildStageNodes`, `flattenPipelineNode`, `resolveSelectedAncestors`, `monitorPipelineStageNodeId`
- `v2/src/daemon/pipeline-observation.ts` — stage `branchKey`/`position`/`artifact` on `PipelineSnapshot`
- `v2/src/execution/pipeline-registry.ts` — stage kinds (`workflow` vs `approval`)
