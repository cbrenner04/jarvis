# v2 plan write normalization

The v2 plan-draft write completion path must run the same staged-tree normalization as v1 before
shape validation.

## Decisions

- `executeWriteStep` plan-draft completion invokes `normalizePlanDraftSpecDir` on the staging
  directory before `validatePlanDraftShape` — rules out v2-only emit-as-drafted behavior or deferring
  v2 without a named follow-on.

## Tasks

- Wire `normalizePlanDraftSpecDir` into the v2 plan-draft completion validator chain in
  `v2/src/execution/write.ts`.
- Add a plan-draft completion regression in `v2/src/execution/write.test.ts` using the k=2 staged
  fixture.

## Acceptance criteria

- [x] `v2/src/execution/write.test.ts` drives plan-draft write completion with the k=2 staged
      fixture and asserts the staging directory matches split ground truth before shape validation
      passes; it fails against the pre-change path.

## Documentation updates

- None — [05](./05-documentation.md) records operator-facing behavior.
