---
name: absent-pipeline-admits-implement
---

# Absent project `pipeline` admits implement dispatch

## Problem

`buildImplementWorkflowSteps` always runs `admitProjectPipeline`, which calls
`resolveProjectPipeline` on `readProjectPipelineConfig`. A registry project with no
`pipeline` key yields `pipeline: undefined`, which the resolver treats as
`invalid-project-pipeline-config`, so `jarvis run workflow implement` refuses every
project that has not opted in — the default today.

## Decisions

- Key absence (`pipeline` not on the project object) means no pipeline selected; implement admission proceeds without `pipelineDefinition`. Rules out classifying absence as malformation.
- Key presence is detected with `'pipeline' in project` on the raw `projects.<key>` object, not fragment truthiness; `pipeline: {}` stays present and malformed. Rules out skipping resolution when `pipeline` is undefined from a missing key only via a loose read.
- `admitProjectPipeline` skips `resolveProjectPipeline` when the key is absent; `resolveProjectPipeline` keeps rejecting an explicit `undefined`/`null` fragment passed by unit tests. Rules out redefining resolver success for bare `undefined` while admission still calls it unchanged.
- Present malformed `pipeline` and valid `pipeline` keep the existing resolver and admission error paths. Rules out relaxing validation for opted-in projects.
- Resolved definitions stay unconsumed beyond the built result; admission-only. Rules out execution wiring in this change.

## Acceptance criteria

- [ ] `buildImplementWorkflowSteps` with a registered project that has no `pipeline` key returns `ok: true` and omits `pipelineDefinition`; a new case in `v2/src/execution/implement-workflow-steps.test.ts` fails on current `main`.
- [ ] `jarvis run workflow implement` with that pipeline-free registry entry reaches durable admission effects (extend `workflow.test.ts` `"project pipeline selection gates implement before durable admission effects"` or add a sibling case in that describe block).
- [ ] Valid `pipeline` still attaches the resolved definition: existing `project-pipeline-resolution.test.ts` case `"resolves the configured source-owned definition and reports a named registry miss without a default"` stays green; `workflow.test.ts` valid-path expectations on `pipelineDefinition?.name` stay green.
- [ ] Present malformed `pipeline` still refuses with existing path-specific errors: keep `project-pipeline-resolution.test.ts` `rejects %s path-specifically before lookup` rows for `{}`, non-object, and bad `name`/`reviewOverrides` green; keep `workflow.test.ts` `test.each` malformed-config stderr rows green.
- [ ] Inverting the absence guard (treat missing key as malformed again) turns the new `implement-workflow-steps.test.ts` case RED.

## Documentation updates

- `v2/docs/install-and-config.md` — `projects.<key>.pipeline` is optional; absence means no pipeline selected (replace language that implies every project must select a pipeline).

## Prerequisites

- Implement workflow build runs project pipeline admission via `readProjectPipelineConfig` and `resolveProjectPipeline` before returning steps.
