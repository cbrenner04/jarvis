# Execution loop

`jarvis run workflow implement` refuses pre-admission with `invalid-project-pipeline-config`
when `projects.<name>.pipeline` is present but stale, and attaches `pipelineDefinition` when
present and valid — even though implement never reads, resolves, or executes a pipeline.
Stop implement admission from touching `projects.<name>.pipeline`; keep `jarvis pipeline start`
validation unchanged.

## Prerequisites

Lands after merged `absent-pipeline-admits-implement` and deliberately reverses its present-key
resolution path.

## Decisions

- `implement` does not read, validate, or resolve `projects.<name>.pipeline` — absent, valid, or
  stale; admission never attaches `pipelineDefinition`. Reverses the valid-present path from
  `absent-pipeline-admits-implement`.
- Unreadable `projects.<key>` (missing key, non-object entry, or `readProjectConfigRecord`
  returns `undefined`) still refuses implement via a non-pipeline path; only a defined object
  with no `pipeline` key admits legacy implement. Rules out folding `project === undefined`
  into the absent-key skip from `absent-pipeline-admits-implement`.
- `pipeline start` keeps full pre-admission validation of the same block unchanged. Rules out
  weakening the surface that actually executes pipelines.
- Config load does not reject an unparseable `pipeline` block for non-pipeline commands; refusal
  belongs to the command that reads it. Rules out moving the hard failure into `loadMachineConfig`.
- Deferred to first consumer: whether `config show` should warn about a stale `pipeline` block — pin
  when a caller needs it.

## Work

- Remove project-pipeline resolution from `admitProjectPipeline` in `implement-workflow-steps.ts`
  (stop calling `resolveProjectPipeline`; drop `pipelineDefinition` attachment).
- Keep refusal when `readProjectConfigRecord` returns `undefined` on a non-pipeline path; rewrite
  `rejects implement when the project config record is missing` to pin that path.
- Preserve `agentModelConfig` refusal independent of pipeline removal.
- Add `implement-workflow-steps.test.ts` cases: stale `pipeline` (missing `terminalAction`;
  `reviewOverrides` not an object) admit with `ok: true` and no `pipelineDefinition`.
- Rename `workflow.test.ts` describe `"project pipeline selection gates implement before durable
  admission effects"` to reflect non-consumption; present+valid pipeline admits with no
  `pipelineDefinition`; drop invalid-pipeline refusal in that test.
- Remove `workflow.test.ts` `"pipeline %s failure precedes daemon and implement effects"` matrix
  — implement no longer runs project-pipeline resolution.
- Add `workflow.test.ts` CLI cases: stale configs (missing `terminalAction`, invalid
  `reviewOverrides`) admit through durable admission effects with no `pipelineDefinition` on the
  built workflow.
- Add `pipeline.test.ts` missing-`terminalAction` pre-admission refusal; keep existing empty-`name`
  case green.
- Supersede contradictory docs passages (not append-only):
  - `v2/docs/v1-behaviors.md` — present-key resolution narrative (~line 88).
  - `v2/docs/install-and-config.md` — shared implement / `pipeline start` resolution language.
  - `v2/docs/workflow-runner.md` — implement admission gate that validates when key is present.
  - `v2/docs/operator-runbook.md` — replace "optional for implement" with ignored by implement;
    `pipeline start` still requires a valid block.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — admits implement when `projects.<key>.pipeline` is missing `terminalAction` or structurally invalid (e.g. `reviewOverrides` is not an object); both yield `ok: true` with no `pipelineDefinition`; fails against the baseline.
- [ ] `implement-workflow-steps.test.ts` — `admits implement when the registered project omits pipeline` stays green.
- [ ] `implement-workflow-steps.test.ts` — rewrites `rejects implement when the project config record is missing` to pin non-pipeline refusal when `readProjectConfigRecord` returns `undefined`; fails against the baseline.
- [ ] `implement-workflow-steps.test.ts` — re-enabling the `resolveProjectPipeline` call in `admitProjectPipeline` turns the stale-config admission test RED (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `workflow.test.ts` — `jarvis run workflow implement` admits stale configs (missing `terminalAction`, structurally invalid `reviewOverrides`) through durable admission effects with no `pipelineDefinition` on the built workflow; fails against the baseline.
- [ ] `workflow.test.ts` — renames `"project pipeline selection gates implement before durable admission effects"` and rewrites it so present+valid pipeline admits with no `pipelineDefinition`; removes `"pipeline %s failure precedes daemon and implement effects"` matrix expectations that implement runs project-pipeline resolution.
- [ ] `workflow.test.ts` — `admits implement without pipelineDefinition when projects.demo omits pipeline` stays green.
- [ ] `pipeline.test.ts` — adds missing-`terminalAction` pre-admission refusal (existing `rejects invalid project pipeline configuration before daemon connect` covers empty `name` only); `jarvis pipeline start` still refuses with `invalid-project-pipeline-config` naming `projects.<name>.pipeline.terminalAction`; inverting `pipeline.ts` pre-admission resolution refusal makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `pipeline.test.ts` — `rejects invalid project pipeline configuration before daemon connect` stays green.
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/workflow-runner.md`, and `v2/docs/install-and-config.md` state implement ignores `projects.<name>.pipeline` entirely (no present-key resolution on admission); pipeline start still requires a valid block.

## Documentation updates

- `v2/docs/operator-runbook.md` — implement ignores `projects.<name>.pipeline`; pipeline start still requires a valid block.
- `v2/docs/workflow-runner.md` — implement admission contract: no project-pipeline resolution when key is present.
- `v2/docs/install-and-config.md` — `pipeline` key applies to `jarvis pipeline start` only; implement admission does not share project-pipeline resolution.
- `v2/docs/v1-behaviors.md` — record that standalone implement no longer resolves project pipeline config (present or absent); unreadable project records still refuse on a non-pipeline path.
