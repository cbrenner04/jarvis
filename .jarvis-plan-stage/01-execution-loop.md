# Execution loop

`jarvis run workflow implement` refuses pre-admission with `invalid-project-pipeline-config`
when `projects.<name>.pipeline` is present but stale, and attaches `pipelineDefinition` when
present and valid — even though implement never reads, resolves, or executes a pipeline.
Stop implement admission from touching `projects.<name>.pipeline`; keep `jarvis pipeline start`
validation unchanged.

## Decisions

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

- [ ] `v2/docs/operator-runbook.md`, `v2/docs/workflow-runner.md`, and `v2/docs/install-and-config.md` state implement ignores `projects.<name>.pipeline` entirely (no present-key resolution on admission); pipeline start still requires a valid block.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement admission contract: no project-pipeline resolution when key is present.