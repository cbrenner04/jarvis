# Daemon

## Problem

- `jarvis pipeline start` couples reusable admission policy to CLI formatting and attached waiting.

## Decisions

- Export a non-IO admission API taking a project key plus a typed exclusive seed-path/seed-text input and returning an admitted pipeline ID or typed named failure with operator detail; rules out argv, stdout/stderr, or text capture as its contract.
- Keep registry lookup, required project pipeline config, machine-model loading, seed-path validation, `resolveProjectPipeline`, and exactly one `pipeline_start` request in the admission API; rules out caller-specific validation or RPC construction.
- Return immediately after successful `pipeline_start`; rules out `pipeline_wait` or completion-state interpretation inside admission.
- Preserve current error detail while adding typed failure names; rules out string parsing as the reusable caller boundary.
- Deferred to first consumer: TUI presentation and launch-state integration — pin when a caller needs it.


## Task checklist

- Extract the reusable admission input, result, dependency seam, validation, context construction, and `pipeline_start` dispatch from `v2/src/commands/pipeline.ts` into a focused v2 module.
- Refactor `runPipelineStartCommand` into the CLI adapter over that API; retain its attach/detach wait path and formatting.
- Add direct admission coverage for both seed variants, named pre-admission failures, one `pipeline_start`, and zero `pipeline_wait` requests.
- Move rejection coverage to the real extracted guards and add source-mutation directives without production inversion hooks.
- Align the durable CLI boundary and v1 parity catalog.

## Acceptance criteria

- [ ] A new `v2/src/commands/pipeline-start-admission.test.ts` fails against the pre-extraction code, then proves direct seed-path and seed-text admission returns the admitted pipeline ID after exactly one `pipeline_start` and no `pipeline_wait`.
- [ ] Direct admission tests prove unregistered projects, missing or invalid pipeline config, invalid model config, and invalid seed paths return typed named failures with the current operator detail before daemon contact.
- [ ] `v2/src/commands/pipeline.test.ts` pipeline-start attached, detached, seed-path, seed-text, and refusal tests stay green.
- [ ] Every added or moved rejection guard has a `// @mutate` source-replacement directive in `pipeline-start-admission.test.ts`; applying each directive makes the focused test fail, including negative cases that prove refused admission sends no RPC. No production inversion hooks are added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.


## Documentation updates
