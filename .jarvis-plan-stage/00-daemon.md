# Daemon

`jarvis run workflow implement` refuses pre-admission with `invalid-project-pipeline-config`
when `projects.<name>.pipeline` is present but stale, and attaches `pipelineDefinition` when
present and valid — even though implement never reads, resolves, or executes a pipeline.
Stop implement admission from touching `projects.<name>.pipeline`; keep `jarvis pipeline start`
validation unchanged.

## Decisions

- `implement` does not read, validate, or resolve `projects.<name>.pipeline` — absent, valid, or stale; admission never attaches `pipelineDefinition`. Rules out present-key resolution from `absent-pipeline-admits-implement`.
- `pipeline start` keeps full pre-admission validation of the same block unchanged. Rules out weakening the surface that actually executes pipelines.
- Config load does not reject an unparseable `pipeline` block for non-pipeline commands; refusal belongs to the command that reads it. Rules out moving the hard failure into `loadMachineConfig`.
- Deferred to first consumer: whether `config show` should warn about a stale `pipeline` block — pin when a caller needs it.


## Work

- Remove project-pipeline resolution from `admitProjectPipeline` in `implement-workflow-steps.ts` (stop calling `resolveProjectPipeline`; drop `pipelineDefinition` attachment).
- Add `implement-workflow-steps.test.ts` cases: stale `pipeline` (missing `terminalAction`; `reviewOverrides` not an object) admit with `ok: true` and no `pipelineDefinition`.
- Remove or rewrite `rejects implement when the project config record is missing` — it pins pipeline-resolution refusal on a malformed project record; that path is removed.
- Rewrite `workflow.test.ts` `"project pipeline selection gates implement before durable admission effects"`: present+valid pipeline admits with no `pipelineDefinition`; drop invalid-pipeline refusal in that test.
- Remove `workflow.test.ts` `"pipeline %s failure precedes daemon and implement effects"` matrix — implement no longer runs project-pipeline resolution.
- Add `workflow.test.ts` CLI cases: stale configs (missing `terminalAction`, invalid `reviewOverrides`) admit through durable admission effects.
- Add `pipeline.test.ts` missing-`terminalAction` pre-admission refusal; keep existing empty-`name` case green.
- Align `v2/docs/operator-runbook.md`, `v2/docs/workflow-runner.md`, `v2/docs/install-and-config.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — admits implement when `projects.<key>.pipeline` is missing `terminalAction` or structurally invalid (e.g. `reviewOverrides` is not an object); both yield `ok: true` with no `pipelineDefinition`; fails against the baseline.
- [ ] `workflow.test.ts` — `jarvis run workflow implement` admits and dispatches against the same stale configs (missing `terminalAction`, structurally invalid `reviewOverrides`); fails against the baseline.
- [ ] `workflow.test.ts` — rewrites `"project pipeline selection gates implement before durable admission effects"` so present+valid pipeline admits with no `pipelineDefinition`; removes `"pipeline %s failure precedes daemon and implement effects"` matrix expectations that implement runs project-pipeline resolution.
- [ ] `pipeline.test.ts` — adds missing-`terminalAction` pre-admission refusal (existing `"rejects invalid project pipeline configuration before daemon connect"` covers empty `name` only); `jarvis pipeline start` still refuses with `invalid-project-pipeline-config` naming `projects.<name>.pipeline.terminalAction`; inverting `pipeline.ts` pre-admission resolution refusal makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `implement-workflow-steps.test.ts` — inverting the implement admission guard that skips project-pipeline resolution makes the stale-config admission test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `v2/docs/v1-behaviors.md` records that standalone implement no longer resolves project pipeline config (present or absent).


## Documentation updates

- `v2/docs/operator-runbook.md` — implement ignores `projects.<name>.pipeline`; pipeline start still requires a valid block.
- `v2/docs/install-and-config.md` — `pipeline` key applies to `jarvis pipeline start` only; implement admission does not share project-pipeline resolution.
- `v2/docs/v1-behaviors.md` — record that standalone implement no longer resolves project pipeline config (present or absent).
