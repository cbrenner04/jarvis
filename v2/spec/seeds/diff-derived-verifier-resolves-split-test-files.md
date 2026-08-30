# Diff-derived mutation verifier misses killing tests in split sibling test files

## Problem

`resolveCoLocatedKillingTest` (`v2/src/execution/diff-derived-mutation-verifier.ts:385`) maps a changed production file `foo.ts` to the single exact-stem path `foo.test.ts`. Large source files whose tests are split by concern across sibling files (`foo-a.test.ts`, `foo-b.test.ts`, …) have no exact-stem `foo.test.ts`, so every changed guard in them resolves to a nonexistent file and the verifier reports `surviving_mutation_failed` with mutation kind `missing-killing-test` — stranding the implement at publication even when a sibling test kills the mutation.

`v2/src/execution/workflow-runner.ts` (5,000+ lines) is the standing example: its tests live in `workflow-runner-plan.test.ts`, `workflow-runner-publication.test.ts`, `workflow-runner-resume.test.ts`, etc. There is no `workflow-runner.test.ts`. So any implement touching a guard in `workflow-runner.ts` strands on `missing-killing-test`.

## Evidence (2026-08-30)

Subspec 01 of `execution-terminal-run-settlement-invariant` (spec `20260830T041008Z-...`) changed a guard in `workflow-runner.ts`. Hand-finish ran `verifyDiffDerivedMutations` against the committed diff: `surviving-mutation` / `missing-killing-test` at `workflow-runner.ts:3882` (the `isFlip` guard in `resumePublicationFailureBoundaryFields`). The behavior is covered — `workflow-runner-publication.test.ts`'s `ready_flip_failed keeps completed with atomic non-resumable cause` kills a mutation of that guard — but it lives in a sibling file the exact-stem resolver never inspects. The original implement run would have stranded here at the mutation gate had it not stranded earlier on biome complexity.

## Decisions

- `resolveCoLocatedKillingTest` (or its consumer) resolves killing-test candidates from every sibling `<stem>-*.test.ts` (and `<stem>.test.ts`) in the same directory, not only the exact-stem file. Rules out declaring `missing-killing-test` for a guard a sibling test already covers.
- A mutation is killed when ANY resolved sibling test dies under it; the verifier only reports `missing-killing-test` when no sibling test in the set exists. Rules out running every sibling and requiring all to fail.
- Preserve the existing exact-stem behavior for files that do have a co-located `<stem>.test.ts`. Rules out a rewrite that changes coverage resolution for the common single-test-file case.
- Bound the sibling set to the same directory and the same stem prefix; do not glob the whole tree. Rules out running unrelated test files and inflating verification wall clock.

## Acceptance criteria

- [ ] A unit test proves `resolveCoLocatedKillingTest` (or the coverage-resolution seam) returns the set of existing sibling `<stem>-*.test.ts` files for a production path whose exact-stem `<stem>.test.ts` is absent (fixture: `foo.ts` with `foo-a.test.ts` + `foo-b.test.ts` present, `foo.test.ts` absent); it fails against the exact-stem-only resolver.
- [ ] A unit test proves a production path with a co-located `<stem>.test.ts` still resolves that file (existing behavior preserved).
- [ ] A `verifyDiffDerivedMutations` test proves a changed guard whose only killing test is in a sibling `<stem>-*.test.ts` yields NO `missing-killing-test` when that sibling kills the mutation; it fails against the exact-stem resolver, which reports `missing-killing-test`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` (or wherever diff-derived mutation verification is documented) — note the co-located killing-test resolver inspects sibling `<stem>-*.test.ts` files, not only the exact-stem file.
