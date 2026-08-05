# Pinning test resolution

## Problem

- Pinning-test lookup uses basename search only and ignores path-qualified backtick references.
- Ambiguous basename matches and zero matches are reported to stderr but do not block completion.
- Basename-only resolution fails when the same test basename appears in multiple directories.

## Decisions

- Resolve the first backticked test path as repo-relative when it contains a path separator; otherwise use basename search — rules out ignoring author-supplied paths.
- Treat zero matches and multiple basename matches as `unresolved_pinning_test` failures that block completion like `hollow` — rules out stderr-only refusal.
- Keep exactly-one-basename-match behavior unchanged — rules out breaking existing single-match pins.
- Reuse the subspec 00 unparseable gate for unresolved pinning outcomes — rules out a second refusal surface.

## Tasks

- Extend pinning-test resolution in `mutation-checkpoint-verifier.ts` to honor repo-relative backtick paths before basename search.
- Name ambiguous basename and missing-file outcomes with criterion text, raw reference, and reason at the completion boundary.
- Add regressions for path-qualified `v2/src/execution/write.test.ts`, ambiguous basename, missing file, and unchanged single-basename resolution.
- Run a fixture pass over `v2/spec/completed/20260802T035103Z-execution-loop-human-only-contracts/00-prove-execution-loop-human-only-contracts.md`.
- Update authoring guidance for path-qualified pinning when basename is not unique.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `unresolved pinning test blocks completion` proves a ticked mutation-checkpoint criterion whose pinning reference resolves to no file returns `contract_miss` (via `write.test.ts` or direct boundary wiring) with criterion text, raw reference, and reason; it fails against the stderr-only path.
- [ ] `mutation-checkpoint-verifier.test.ts` — `ambiguous pinning-test basename blocks completion` proves more than one basename match blocks completion with the same named fields; it fails against the stderr-only path.
- [ ] `mutation-checkpoint-verifier.test.ts` — `path-qualified pinning test resolves exactly` proves a criterion referencing `` `v2/src/execution/write.test.ts` `` resolves to that file and verifies end to end even when `write.test.ts` is duplicated elsewhere in the repo.
- [ ] `mutation-checkpoint-verifier.test.ts` — `single basename match still resolves` proves a bare-basename reference with exactly one repo match keeps today's resolution behavior.
- [ ] `mutation-checkpoint-verifier.test.ts` — `execution-loop human-only fixture reports zero unparseable and two caught` runs verification over `v2/spec/completed/20260802T035103Z-execution-loop-human-only-contracts/00-prove-execution-loop-human-only-contracts.md` (or equivalent fixture with a `write.test.ts` reference) and asserts zero `unparseable` and two `caught` directives.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to reference pinning tests by repo-relative path when basename is not unique.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — path-qualified pinning when basename is ambiguous.
