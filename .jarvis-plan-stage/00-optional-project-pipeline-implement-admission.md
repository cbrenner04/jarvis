# Optional project pipeline at implement admission

Registered projects without a `projects.<key>.pipeline` key are refused at implement
launch because `admitProjectPipeline` always resolves `readProjectPipelineConfig`'s
`pipeline: undefined` through `resolveProjectPipeline`. Treat absent `pipeline` as no
selection: admit the legacy implement workflow without `pipelineDefinition`. Present
`pipeline` keeps strict parse, lookup, override-target, and validation gates.

## Decisions

- Absent `pipeline` key on `projects.<key>` means no pipeline selected; implement admission returns `ok: true` and omits `pipelineDefinition`. Rules out treating absence as `invalid-project-pipeline-config`.
- Key presence uses `'pipeline' in project` on the raw `projects.<key>` object, not fragment truthiness; `pipeline: {}` remains present and malformed. Rules out skipping resolution whenever the read fragment is `undefined`.
- `admitProjectPipeline` skips `resolveProjectPipeline` when the key is absent; `resolveProjectPipeline` keeps rejecting explicit `undefined`/`null` fragments in unit tests. Rules out making bare `undefined` resolve successfully while admission still always calls the resolver.
- Present malformed or valid `pipeline` keeps existing resolver and admission error paths unchanged. Rules out relaxing validation for opted-in projects.
- Resolved definitions remain admission evidence on the build result only; no pipeline stage execution wiring. Rules out coupling this slice to the pipeline execution consumer.

## Work

- Teach implement pipeline admission to bypass resolution when `pipeline` is absent on the matched project config object.
- Add `implement-workflow-steps.test.ts` coverage for a registry project with no `pipeline` key.
- Extend `workflow.test.ts` pipeline-admission coverage so a pipeline-free registry entry reaches durable admission effects (same describe block as `"project pipeline selection gates implement before durable admission effects"`).
- Align `v2/docs/install-and-config.md` with optional `pipeline`.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` case `admits implement when the registered project omits pipeline` asserts `buildImplementWorkflowSteps` returns `ok: true` without `pipelineDefinition` for a matched project whose config object has no `pipeline` key; fails on current `main`.
- [ ] `workflow.test.ts` regression (extend `"project pipeline selection gates implement before durable admission effects"` or add a sibling in that describe) drives `jarvis run workflow implement` with a pipeline-free `projects.demo` entry through durable admission (daemon connection, run rows, worktree materialization, agent invocation) and exit `0`; fails on current `main`.
- [ ] `project-pipeline-resolution.test.ts` `"resolves the configured source-owned definition and reports a named registry miss without a default"` stays green.
- [ ] `workflow.test.ts` valid-path `pipelineDefinition?.name` expectations in `"project pipeline selection gates implement before durable admission effects"` stay green.
- [ ] `project-pipeline-resolution.test.ts` `rejects %s path-specifically before lookup` rows for `{}`, non-object, and bad `name`/`reviewOverrides` stay green.
- [ ] `workflow.test.ts` `test.each` malformed-config stderr rows in `"pipeline %s failure precedes daemon and implement effects"` stay green.
- [ ] Inverting the absent-key guard (treat missing `pipeline` as malformed again) turns `implement-workflow-steps.test.ts` `admits implement when the registered project omits pipeline` RED.

## Documentation updates

- `v2/docs/install-and-config.md` — `projects.<key>.pipeline` is optional; absence means no pipeline selected (replace language that implies every project must select a pipeline).
