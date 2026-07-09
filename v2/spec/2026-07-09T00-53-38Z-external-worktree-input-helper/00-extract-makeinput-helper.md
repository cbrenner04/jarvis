# Extract makeInput helper

`v2/src/execution/external-worktree.test.ts` repeats the same 7-line
`withExternalWorktree` input object (`projectRoot`, `projectName: "demo"`,
`branchName: "write-run"`, `baseRef: "HEAD"`, `jarvisRoot`) across all 8
tests.

## Decisions

- Add a `makeInput(jarvisRoot, projectRoot)` helper that returns the shared
  input object; call sites pass overrides only where a test varies a field
  (e.g. the "different repository" test's second call uses `otherRepoRoot`).
- Test-only change: no `src/` edits, no behavior change.

## Task checklist

- [ ] Add `makeInput` helper near the top of `external-worktree.test.ts`.
- [ ] Replace each inline input object literal with a `makeInput(...)` call.

## Acceptance criteria

- [ ] `external-worktree.test.ts` stays green (behavior unchanged by the extraction).
- [ ] Test count in `external-worktree.test.ts` is unchanged vs baseline (PR body states the before/after count).
- [ ] No repeated 5-field `withExternalWorktree` input literal remains in the file; each call site uses the `makeInput` helper.

## Documentation updates

- None: internal test-only refactor, no operator-facing or v1 behavior change.
