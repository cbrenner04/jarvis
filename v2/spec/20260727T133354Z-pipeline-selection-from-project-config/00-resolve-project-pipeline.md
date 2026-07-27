# Parse and resolve the project pipeline

Project config cannot select or safely specialize the source registry today. Add a
side-effect-free resolver that reads a registered project's retained config fragment,
composes posture overrides, and validates a separately owned result. Admission wiring is
the next subspec.

## Decisions

- `readProjectPipelineConfig(projectKey, configPath)` owns this config read: it reads the raw `projects.<key>` object from `readMachineConfigDocument`, while `readProjectRegistry` remains the root/origin projection used for project matching. It returns that project's `pipeline` fragment plus its key; fields therefore cannot be lost in the registry projection.
- `projects.<key>.pipeline` is exactly `{ "name": string, "reviewOverrides"?: { "<stageId>": string } }`. The resolver receives this raw fragment, the project key, the source registry lookup, and already-resolved `AgentModelConfig`; it neither reads files nor loads machine profiles.
- `pipeline` must be an object. Its `name` must be a non-empty string. When present, `reviewOverrides` must be an object and every value must be a string. Missing `pipeline`, non-objects, missing/empty/non-string names, malformed overrides, non-string override values, and every other `pipeline` key return `invalid-project-pipeline-config` with the full offending path in `key` and a message; no form defaults to `fast` or another entry.
- Parsing is first, before registry lookup. A parsed name then performs lookup; only after a hit are override targets checked; then the copied composed definition is unconditionally passed to `validatePipelineDefinition`, including with no overrides. Ordering among multiple malformed override entries is not contractual.
- `reviewOverrides` is keyed by workflow `stageId`, not workflow name. Each key must name an existing workflow stage; unknown IDs and approval-stage targets are `invalid-project-pipeline-config` at that override key.
- A registry miss remains `unknown-pipeline` with the requested name. Definition-validator failure is `invalid-pipeline-definition` carrying every existing `{ code, stageId, field, message }` error; no new validator or broader dispatch guarantee is implied.
- Resolution deeply copies the definition and every stage even when no override applies. Source registry definitions are not mutated, and resolved copies cannot affect one another.
- `projects.<key>.pipeline.reviewOverrides` controls only review posture on stages of the selected pipeline. Existing `projects.<key>.implement.reviewBehavior` and its CLI flag continue to control the legacy post-implement review step; neither overrides nor composes with the other. This remains true until a later pipeline-execution migration explicitly replaces that legacy step.

## Task checklist

- Retain each registered project's raw pipeline fragment while preserving the root/origin project-registry projection.
- Add strict project-pipeline parsing, source lookup, deep copy-on-compose posture overrides, and unconditional definition validation.
- Cover valid selection, registry miss, every malformed/forbidden shape, override targeting, validator errors, and copy isolation.
- Document the operator schema, precedence, and the distinct legacy implement-review setting.

## Acceptance criteria

- [x] `v2/src/execution/project-pipeline-resolution.test.ts` resolves a registered project to the named source-owned definition; an unknown configured name returns `unknown-pipeline` with that name, without throwing or choosing a default.
- [x] The test rejects path-specifically: missing/non-object `pipeline`; missing, empty, or non-string `pipeline.name`; malformed `pipeline.reviewOverrides`; non-string override values; and forbidden keys including `pipeline.stages`, `pipeline.prompt`, and `pipeline.code`. Parsing failures occur before lookup.
- [x] A review override changes only its named workflow stage in the resolved copy; unknown stage IDs and approval-stage targets name their offending `reviewOverrides` key; later source or other-project resolutions retain their original posture and independent stage objects, including without overrides.
- [x] Invalid override posture reaches `validatePipelineDefinition`; its result preserves every existing error's stage ID, `review` field, code, and message. The validator is also called for a selected definition with no overrides.
- [x] Inverting the parsing, registry hit/miss, workflow-stage target, deep-copy, or validation-result guard makes its positive or negative test fail.
- [x] `v2/docs/install-and-config.md` documents `pipeline.name`, stage-ID-keyed `reviewOverrides`, strict named errors, a complete project example, and its non-composition with `implement.reviewBehavior`.

## Documentation updates

- `v2/docs/install-and-config.md` — pipeline selection schema, overrides, strict errors, example, and legacy review-setting precedence.
