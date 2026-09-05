# Shared write-sibling step-id matcher

## Problem

Write-sibling step-id grammar (`<stepId>`, `<stepId>~link-N`, `<stepId>~shrink`) and snapshot base-step resolution are duplicated: `workflow-runner-resume.ts` matches `~link-N` locally, `daemon-run-lifecycle-handlers.ts` special-cases `~shrink` with a raw suffix slice, and neither surface shares one contract.

## Decisions

- Add `shared/write-sibling-step-id.ts` composing `shared/shrink-step-id.ts`; rules out each surface re-implementing suffix rules or magic slice lengths.
- Export matchers for exact ids, `~link-N` siblings, and hidden-shrink ids plus `resolveAuthoredStepId` / `findSnapshotStepForRunStepId` that map a persisted run `stepId` to the authored snapshot step; rules out ad hoc `startsWith` / `endsWith` / `slice` at call sites.
- `~link-N` index `N` is opaque to the matcher — link ordinal parsing for resume routing stays in execution-loop helpers that consume the shared base-step resolution; rules out baking linked-index routing into the shared module.
- Sibling-selection consumers (`resolveDurableWriteSiblingRun` and equivalents) use exact + `~link-N` matching only; `~shrink` ids resolve through snapshot base-step helpers but never enter sibling tie-breaking; rules out shrink rows competing in write-sibling selection.

## Tasks

- [ ] Add `shared/write-sibling-step-id.ts` with the suffix constants and helpers above, importing shrink helpers from `shared/shrink-step-id.ts`.
- [ ] Add `shared/write-sibling-step-id.test.ts` covering exact, `~link-N`, and `~shrink` ids and snapshot step lookup for representative workflow step lists.

## Acceptance criteria

- [ ] `shared/write-sibling-step-id.test.ts` asserts sibling and shrink matching and snapshot base-step resolution; it fails against the pre-fix absence of `shared/write-sibling-step-id.ts`.

## Documentation updates

None — shared matcher contract is documented in `03` (`v2/docs/workflow-runner.md`).
