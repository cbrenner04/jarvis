# Pinning test resolution

## Problem

- Pinning-test lookup uses basename search only and ignores path-qualified backtick references.
- Ambiguous basename matches and zero matches are reported to stderr but do not block completion.
- Basename-only resolution fails when the same test basename appears in multiple directories.

## Decisions

- When the first backticked test reference contains a path separator: normalize to repo-relative POSIX paths, resolve under the worktree root with escape-root rejection, and **do not** fall back to basename search when the qualified path is missing — rules out guessing past an author-supplied path.
- When the reference has no path separator: basename search; zero or multiple matches are `unresolved_pinning_test` failures that block completion like `hollow` — rules out stderr-only refusal.
- Keep exactly-one-basename-match behavior unchanged — rules out breaking existing single-match pins.
- Reuse the subspec 00 file-scoped unparseable gate for unresolved pinning outcomes — rules out a second refusal surface.
- `v2/docs/v1-behaviors.md` reconciliation lands in subspec 03 — rules out catalog drift in this slice.

## Tasks

- Extend pinning-test resolution in `mutation-checkpoint-verifier.ts` to honor repo-relative backtick paths before basename search.
- Name ambiguous basename and missing-file outcomes with criterion text, raw reference, and reason at the completion boundary (`write.ts`).
- Add regressions for path-qualified `v2/src/execution/write.test.ts`, ambiguous basename, missing file, and unchanged single-basename resolution.
- Author a dedicated path-qualified pinning fixture at `v2/src/execution/fixtures/path-qualified-pinning-subspec.md` with two ticked mutation-checkpoint criteria referencing `` `v2/src/execution/write.test.ts` `` and two linked `@mutate` directives; run a fixture pass over it.
- Update authoring guidance for path-qualified pinning when basename is not unique.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `unresolved pinning test is reported` proves a ticked mutation-checkpoint criterion whose pinning reference resolves to no file yields `unresolved_pinning_test` with criterion text, raw reference, and reason; it fails against basename-only stderr-only behavior.
- [ ] `mutation-checkpoint-verifier.test.ts` — `ambiguous pinning-test basename is reported` proves more than one basename match yields `unresolved_pinning_test` with the same named fields; it fails against stderr-only behavior.
- [ ] `write.test.ts` — `unresolved pinning test blocks completion` proves `spec.criteria-ticked` returns `contract_miss` with criterion text, raw reference, and reason for zero-match pinning resolution; it fails against the stderr-only path.
- [ ] `write.test.ts` — `ambiguous pinning-test basename blocks completion` proves `spec.criteria-ticked` returns `contract_miss` with the same named fields for ambiguous basename resolution; it fails against the stderr-only path.
- [ ] `mutation-checkpoint-verifier.test.ts` — `path-qualified pinning test resolves exactly` proves a criterion referencing `` `v2/src/execution/write.test.ts` `` resolves to that file and verifies end to end even when `write.test.ts` is duplicated elsewhere in the repo.
- [ ] `mutation-checkpoint-verifier.test.ts` — `qualified path with no file does not fall back to basename` proves a path-qualified reference that does not resolve is `unresolved_pinning_test` even when the basename alone would match exactly one file.
- [ ] `mutation-checkpoint-verifier.test.ts` — `single basename match still resolves` proves a bare-basename reference with exactly one repo match keeps today's resolution behavior.
- [ ] `mutation-checkpoint-verifier.test.ts` — `path-qualified pinning fixture reports zero unparseable and two caught` runs verification over `v2/src/execution/fixtures/path-qualified-pinning-subspec.md` and asserts zero `unparseable` and two `caught` directives.
- [ ] `write.test.ts` — `unresolved pinning test blocks completion`; Mutation checkpoint: its regression carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "<path-first resolution guard>" -> "<basename-only resolution>"` (revert path-first resolution); reverting the real guard turns the named pin red.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to reference pinning tests by repo-relative path when basename is not unique.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — path-qualified pinning when basename is ambiguous (`v2/docs/v1-behaviors.md` reconciled in subspec 03).
