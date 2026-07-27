# Emit single-boundary drafts unchanged

Single-boundary drafted subspecs must pass through split normalization without rewritten prose,
renumbering, or extra files.

## Decisions

- Pass-through applies when every `NN-*.md` subspec's acceptance criteria union is exactly one module
  boundary per [00](./00-module-boundary-classifier.md) — rules out rewriting single-boundary drafts
  for "consistency" formatting.
- Normalization is a no-op on the subspec set when no drafted subspec triggers multi-boundary
  detection — rules out always renumbering or re-heading pass-through trees.

## Tasks

- Cover a single-boundary staged fixture through `normalizePlanDraftSpecDir` in
  `v1/test/modes/plan/plan-draft-boundary-split.test.ts`.
- Confirm existing plan draft tests still exercise pass-through paths.

## Acceptance criteria

- [ ] `v1/test/modes/plan/plan-draft-boundary-split.test.ts` asserts a single-boundary fixture
      leaves subspec count, filenames, and file bytes unchanged after normalization; it fails if
      normalization splits or rewrites pass-through drafts.
- [ ] `v1/test/modes/plan/spec-dir.test.ts` stays green.
- [ ] `v1/test/plan-draft-hard-error-continue.test.ts` stays green.
- [ ] `v2/src/execution/write.test.ts` plan-draft tests stay green.

## Documentation updates

- None — [05](./05-documentation.md) records the operator contract.
