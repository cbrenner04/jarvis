# Resolve project pipeline before admission

Project config cannot select or safely specialize the source registry today. Add one
side-effect-free boundary that reads a project's selection, composes posture overrides,
and validates the result before later daemon execution can admit it.

## Decisions

- `projects.<key>.pipeline` is `{ "name": string, "reviewOverrides"?: { "<stageId>": string } }`, with posture semantics delegated to `validatePipelineDefinition`; rules out workflow-name keys, which cannot distinguish repeated workflow stages, and a second posture validator.
- `pipeline` permits only `name` and `reviewOverrides`; reject any other key with its full config path, rather than ignoring prompt, stage, or executable-code fields.
- Config-shape and override-target failures return `invalid-project-pipeline-config` with `key` and `message`; rules out throws and string-only failures.
- Missing or malformed `pipeline.name` is `invalid-project-pipeline-config`; rules out defaulting to `fast` or another registry entry.
- Each override must name an existing workflow stage; reject unknown stage IDs and approval-stage targets, rather than silently dropping them.
- Composition returns a copied definition and never mutates the source registry; rules out one project's overrides leaking into another resolution.
- Registry misses retain `unknown-pipeline`; composed-definition failures return `invalid-pipeline-definition` carrying every existing `{ code, stageId, field, message }` validation error, rather than collapsing either case into a generic config error.
- The resolver accepts the already-resolved `AgentModelConfig`; rules out loading machine profiles inside composition and preserves the validator's pure dependency boundary.
- Resolution is the admission boundary and has no state-store, worktree, or invocation capability; rules out validation after materialization.
- Deferred to first consumer: CLI/RPC rendering and daemon pipeline-start wiring — pin when durable pipeline execution consumes this resolver.

## Task checklist

- Add strict project-pipeline config parsing with named key-path errors.
- Add project selection lookup, copy-on-compose posture overrides, and composed-definition validation.
- Cover valid selection, registry miss, malformed/forbidden config, override targeting, validation failure, source immutability, and pre-admission side-effect absence.
- Document the operator schema and the resolution boundary.

## Acceptance criteria

- [ ] `v2/src/execution/project-pipeline-resolution.test.ts` resolves a registered project to its named source-owned definition and fails against the baseline where project pipeline resolution does not exist.
- [ ] The same test proves an unknown configured name returns `unknown-pipeline` with the requested name, without throwing or selecting a default.
- [ ] Config containing `pipeline.stages`, `pipeline.prompt`, or `pipeline.code` is rejected before lookup with an error naming the exact offending key; accepted config permits no definition-authoring field.
- [ ] A review override changes only its named workflow stage in the resolved copy; resolving the source definition or another project afterward retains the registry posture unchanged.
- [ ] Unknown stage IDs and approval-stage override targets are rejected with errors naming the offending `reviewOverrides` key.
- [ ] Invalid override posture reaches `validatePipelineDefinition` and returns its existing stage ID, `review` field, error code, and message; all composed-definition validation errors are preserved.
- [ ] The invalid-definition test instruments run-row creation, worktree creation, and agent invocation and proves all remain at zero because resolution fails before admission.
- [ ] Inverting the allowed-key guard, registry hit/miss guard, workflow-stage override guard, copy-on-compose boundary, or validation-result guard makes the corresponding positive or negative test fail; suppressing effects on invalid input is covered by zero-effect assertions.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/install-and-config.md` documents `pipeline.name`, stage-ID-keyed `reviewOverrides`, strict rejection, named errors, and a complete project example.
- [ ] `v2/docs/workflow-runner.md` documents copy-on-compose resolution, validation before admission, and the deferred daemon/CLI consumer boundary.

## Documentation updates

- `v2/docs/install-and-config.md` — pipeline selection schema, overrides, strict errors, example.
- `v2/docs/workflow-runner.md` — composition and pre-admission resolution contract.
