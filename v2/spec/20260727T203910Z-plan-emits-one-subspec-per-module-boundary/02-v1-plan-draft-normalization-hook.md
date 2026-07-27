# v1 plan-draft normalization hook

Every v1 path that validates or commits plan draft output must run boundary normalization through
one shared entry point before structural checks.

## Decisions

- `normalizePlanDraftSpecDir` runs at the start of `validateDraftOutput` in
  `v1/src/modes/plan/draft.ts` — rules out wiring beside only one of the `run.ts` call sites;
  draft-commit and recovery/resume both call `validateDraftOutput` and therefore normalize.
- Normalization precedes existing per-subspec structural validation inside `validateDraftOutput` —
  rules out validating an unsplit oversized tree.

## Tasks

- Import and invoke `normalizePlanDraftSpecDir` from `validateDraftOutput` before structural parsing.
- Extend `v1/test/modes/plan/plan-draft-boundary-split.test.ts` with a worktree fixture exercised
  through `validateDraftOutput`.

## Acceptance criteria

- [ ] `v1/test/modes/plan/plan-draft-boundary-split.test.ts` copies the k=2 staged fixture into a
      temp worktree, calls `validateDraftOutput`, and asserts the on-disk tree matches the split
      ground truth before validation succeeds; it fails against the pre-change path.
- [ ] `bun run typecheck` passes.

## Documentation updates

- None — [05](./05-documentation.md) updates `v2/docs/v1-behaviors.md` validation order.
