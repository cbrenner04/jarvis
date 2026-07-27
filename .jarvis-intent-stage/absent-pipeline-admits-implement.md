---
name: absent-pipeline-admits-implement
---

# An absent `pipeline` key admits implement unchanged

## Problem

`admitProjectPipeline` runs on every implement build and treats a missing
`projects.<key>.pipeline` as `invalid-project-pipeline-config`, so pipeline-free
projects cannot dispatch implement at all. Nothing consumes a resolved definition
yet; the refusal blocks the primary command.

## Decisions

- Absent `pipeline` resolves to no pipeline selected and admission proceeds without a `pipelineDefinition` — rules out treating absence as `invalid-project-pipeline-config`.
- Present but malformed `pipeline` still fails with the existing path-specific error — rules out relaxing validation for opted-in configs.
- Absence vs presence is keyed by the `pipeline` property, not object emptiness: `pipeline: {}` is present and malformed — rules out a truthiness check.
- Admission-only change; resolved definitions for selecting projects stay unconsumed until the execution slice — rules out wiring pipeline stage execution here.

## Acceptance criteria

- [ ] `jarvis run workflow implement` on a registry entry with no `pipeline` key admits and dispatches as before the admission gate; a build-level test with a pipeline-free project fails against the current refusal.
- [ ] A project with a valid `pipeline` still resolves its definition onto the built result.
- [ ] Present but malformed `pipeline` (`{}`, non-object, bad `name`, bad `reviewOverrides`) still refuses with the existing path-specific error — one test per shape.
- [ ] Inverting the absence check turns the pipeline-free admission test RED.

## Documentation updates

- `v2/docs/install-and-config.md` — `pipeline` is optional; absence means no pipeline selected.

## Prerequisites

- Implement workflow build invokes project-pipeline resolution on the matched registry entry before durable admission effects.
