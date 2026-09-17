# Stage-succeeded incident for implement lanes

## Problem

`collectPipelineIncidents` in `v2/src/daemon/operator-incidents.ts` derives only gate, `stage-failed`, and pipeline-terminal incidents. A fan-out lane whose `implement` stage succeeds (PR flipped ready) while siblings wait at gates emits nothing, so the operator has no merge-then-approve wake signal (pipeline `25784a7e`, PR #3918).

## Confirmed prerequisites

- Pipeline definitions carry a per-stage `workflow` field (`WorkflowPipelineStage.workflow`, `v2/src/execution/pipeline-definition.ts`), addressable by `stageId`; `isApprovalAuthoredStage` in `v2/src/persistence/state-store.ts` already does this exact `definition.stages.find((s) => s.stageId === stageId)` lookup for gate rows.
- Implement-stage artifacts store `prNumber`/`prUrl` (`PipelineStageArtifact`, `v2/src/persistence/pipeline-stage-settlement.ts:14-20`), both optional.

## Decisions

- Add `OperatorIncidentKind` `"stage-succeeded"`, emitted per stage row with `status === "succeeded"` while derived pipeline state is non-terminal.
- Workflow type comes from the admitted definition, not the stage row (`PipelineStageRecord` has no `workflow` field): look up `pipeline.definition.stages.find((s) => s.stageId === stage.stageId)`, and require the match to be `kind: "workflow"` with `workflow === "implement"`. Gating on `stageId` alone is wrong — it is a free-form per-pipeline label independent of workflow type. No matching definition entry skips the row silently; it never fails derivation.
- PR fields are read from the stage's `artifact` (typed `unknown | null`), narrowed to `PipelineStageArtifact` shape the same way `pipeline-execution.ts` does (`entryRunId`/`specPath` both present as strings). A missing artifact, one that doesn't narrow, or a narrowed artifact with no `prNumber`/`prUrl` omits those fields rather than failing derivation.
- Incident uses `stageIncidentId(pipelineId, stageId, branchKey)` (shared with `stage-failed`) and transition `succeeded:<endedAt>`, with no `startedAt`/`0` fallback: a succeeded row with a null `endedAt` emits no `stage-succeeded` incident, because two such rows would otherwise collapse onto the same key and a second success is exactly the case this incident exists to distinguish.
- The `succeeded:` transition prefix is distinct from `stage-failed`'s `failed:` prefix, so a lane that fails and later succeeds derives two separate incidents on the same `stageIncidentId`, not one overwriting the other.
- `previewPipelineIncidentKeys` emits the same `stage-succeeded` keys as `collectPipelineIncidents`; diverging keys would make the preview/delivery dedupe re-notify or skip.
- Terminal pipelines emit no `stage-succeeded`; the existing pipeline-terminal incident is the only signal.

## Task checklist

- [ ] Add the kind, definition-lookup helper, transition helper, optional PR-field narrowing, and emission in both collect and preview paths.
- [ ] Add tests in `v2/src/daemon/operator-incidents.test.ts`.
- [ ] Update docs.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/operator-incidents.test.ts` drives a fan-out pipeline whose one lane's `implement`-workflow stage settled `succeeded` (with a PR number, non-null `endedAt`) while a sibling gate is `awaiting`, and asserts exactly one `stage-succeeded` incident carrying `pipelineId`, `stageId`, `branchKey`, and the PR number; it fails against the pre-fix derivation.
- [ ] A test asserts a succeeded stage named `stageId: "implement"` whose definition entry has `workflow: "plan"` derives no `stage-succeeded` incident.
- [ ] A test asserts the same lane re-settling `succeeded` with a later `endedAt` yields a transition key distinct from its first settlement.
- [ ] A test asserts `previewPipelineIncidentKeys` produces exactly the `stage-succeeded` keys that `collectPipelineIncidents` derives for a non-terminal pipeline with a succeeded implement stage.
- [ ] A test drives a lane whose implement stage first settles `failed` then later settles `succeeded`, and asserts both a `stage-failed` and a `stage-succeeded` incident derive as two distinct incidents.
- [ ] A test asserts a succeeded implement stage row with a null `endedAt` derives no `stage-succeeded` incident.
- [ ] A test asserts a single-lane pipeline whose implement stage succeeded and whose derived state is terminal emits only the `pipeline-terminal` incident, no `stage-succeeded`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` § Operator notifications / pipeline stage incidents — document `stage-succeeded` (implement-workflow definition lookup, `succeeded:<endedAt>` transition key with no fallback, PR fields, terminal suppression).
- `v2/docs/v1-behaviors.md` — add a required `[v2 additive]` entry alongside the existing `stage-failed` entry (§ line ~295) documenting the new `stage-succeeded` incident.
