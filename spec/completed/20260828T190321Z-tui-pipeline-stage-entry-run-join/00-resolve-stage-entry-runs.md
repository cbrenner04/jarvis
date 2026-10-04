# Resolve stage entry runs before pipeline-tree attribution

## Problem

Pipeline stages durably record the admitted entry run ID in `workflowInvocationId`, while `buildMonitorPipelineTreeJoin` compares that value directly with each retained run row's distinct `workflow.invocationId`. Production-shaped stages therefore join no workflow runs, construct no branch claims, derive no project or attributed timing, and leave their invocations in the ad-hoc projection.

## Decisions

- This repair is limited to invocation-based consumers inside `buildMonitorPipelineTreeJoin`: stage joins, duplicate ownership, matched-invocation suppression, branch claims, project derivation, and attribution timing. It neither changes monitor-lines, attention-row, nor multi-daemon composition behavior.
- Resolve a stage field by globally matching `run.runId` in the full retained `runs` input, then read that row's `workflow.invocationId` before those consumers — rules out a stage-node-only repair and treating `builderRuns` display filtering as identity retention.
- `builderRuns` continues to govern visible and joined run rows: a queued or hidden entry row can resolve its stage's invocation without rendering itself, while any displayable sibling of that invocation remains joinable. Return no invocation when the retained entry row or its workflow metadata is absent — rules out guessing from branch, project, or the misleading field name.
- Keep durable and wire `workflowInvocationId` unchanged and document that it carries an entry run ID — rules out coupling this projection repair to persistence and protocol migration.
- Preserve existing branch-aware claim shape and last-started tie-breaking after resolution — rules out redesigning attribution while activating it for production-shaped rows.

## Tasks

- [ ] Add one stage-entry-run resolver in `v2/src/tui/tui-monitor-pipeline-tree.ts` that searches full retained `runs`, then use its resolved invocation for every invocation-based consumer in `buildMonitorPipelineTreeJoin`: stage joining, duplicate claiming, matched-invocation suppression, branch-claim construction, pipeline project derivation, and pipeline/branch attributed timing; retain `builderRuns` filtering for rendered and joined rows.
- [ ] Rework every affected TUI fixture under `v2/src/tui/` that represents a resolved stage-entry association so its stage records a distinct entry run ID and the matching run records its workflow invocation ID; stage-only and intentionally unresolved fixtures are exempt.
- [ ] Add focused join tests for an entry row excluded from `builderRuns` (queued and hidden cases), an entry row with no workflow metadata, distinct entry rows resolving to one invocation, and Work/dock consumers of the shared join.
- [ ] Add or update the pinning tests below with each `// @mutate` directive inside its named test body; each quoted original must occur exactly once in its named production file, adjusting the anchor without changing the behavior if implementation shape differs.
  - `a same-branch leaked invocation follows a resolved stage claim`: `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return retainedRuns.find((run) => run.runId === stage.workflowInvocationId)?.workflow?.invocationId ?? null;" -> "return stage.workflowInvocationId;"`
  - `a missing retained entry run leaves the stage unresolved and claimless`: `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return retainedRuns.find((run) => run.runId === stage.workflowInvocationId)?.workflow?.invocationId ?? null;" -> "return retainedRuns.find((run) => run.runId !== stage.workflowInvocationId)?.workflow?.invocationId ?? null;"`
  - `a missing retained entry run leaves the stage unresolved and claimless`: `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return retainedRuns.find((run) => run.runId === stage.workflowInvocationId)?.workflow?.invocationId ?? null;" -> "return retainedRuns.find((run) => run.runId === stage.workflowInvocationId)?.workflow?.invocationId ?? stage.workflowInvocationId;"`
  - `a retained entry row without workflow metadata leaves the stage unresolved and claimless`: `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return retainedRuns.find((run) => run.runId === stage.workflowInvocationId)?.workflow?.invocationId ?? null;" -> "return retainedRuns.find((run) => run.workflow !== undefined)?.workflow?.invocationId ?? null;"`
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [x] `buildMonitorPipelineTreeJoin` test `joins a stage through its recorded entry run and keeps the invocation out of ad-hoc rows` uses distinct entry-run and invocation UUIDs, nests the retained entry run and its invocation siblings under the stage, derives the pipeline project and attributed timing from those joined rows, and emits none of them as ad-hoc; it fails against the pre-fix direct comparison.
- [x] `buildMonitorPipelineTreeJoin` test `a same-branch leaked invocation follows a resolved stage claim` gives the stage a production-shaped entry-run ID, keeps the existing branch-aware claim shape and tie-breaking, attributes the leaked invocation to that stage, and fails when the resolver returns the stage field directly. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a same-branch leaked invocation follows a resolved stage claim`; Keystone checkpoint:
- [x] `buildMonitorPipelineTreeJoin` test `an excluded retained entry run still resolves without rendering itself` supplies queued and hidden matching entry rows outside `builderRuns`; each resolves the stage from the full retained input, joins a displayable invocation sibling without rendering the excluded entry row, and keeps no joined invocation ad-hoc.
- [x] `buildMonitorPipelineTreeJoin` test `a missing retained entry run leaves the stage unresolved and claimless` includes other retained workflow rows, leaves the stage empty with no project, attributed timing, or branch claim, and keeps unrelated invocations ad-hoc; its source directives invert the global run-ID match and change the missing-entry fallback to the recorded field, with each mutation making the scoped test red. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a missing retained entry run leaves the stage unresolved and claimless`; Mutation checkpoint:
- [x] `buildMonitorPipelineTreeJoin` test `a retained entry row without workflow metadata leaves the stage unresolved and claimless` includes other retained workflow rows, leaves the stage empty with no project, attributed timing, or branch claim, and keeps every unrelated invocation ad-hoc; its source directive substitutes an arbitrary workflow row for the metadata-less entry and makes the scoped test red. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a retained entry row without workflow metadata leaves the stage unresolved and claimless`; Mutation checkpoint:
- [x] `buildMonitorPipelineTreeJoin` test `the first stage owns a shared resolved invocation` gives two stages distinct production-shaped entry run IDs that resolve to one invocation, assigns its runs and branch claim to the first stage only, and preserves existing first-stage ownership and last-started tie-breaking.
- [x] `buildMonitorPipelineTreeJoin` retains a genuinely stage-less invocation as one top-level ad-hoc workflow row, and an audit of affected TUI fixtures confirms every resolved stage-entry association uses distinct entry-run and invocation IDs.
- [x] A production-shaped Work/dock count test consuming the shared pipeline-tree join counts resolved invocation rows as staged rather than ad-hoc.
- [x] `v2/docs/v1-behaviors.md` states that the pipeline-tree join resolves a stage's recorded entry run ID to the retained row's workflow invocation ID before stage claims, project/timing attribution, and ad-hoc suppression; Work and dock counts consume that joined result; queued or hidden entry rows may resolve without rendering; and an unretained or metadata-less entry row leaves the stage unresolved and claimless. Its multi-daemon entry states that snapshot composition precedes this pipeline-tree resolution rather than performing it.
- [x] `v2/docs/operator-runbook.md` Observe guidance records the entry-run-to-invocation resolution, unresolved-retention behavior, and production-shaped fixture requirement.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — correct the TUI pipeline-tree and dock-count entries to describe entry-run resolution before joining and attribution; describe multi-daemon composition as preceding, not performing, that resolution.
- `v2/docs/operator-runbook.md` — update Observe with the resolution, unresolved-entry behavior, and fixture invariant.
