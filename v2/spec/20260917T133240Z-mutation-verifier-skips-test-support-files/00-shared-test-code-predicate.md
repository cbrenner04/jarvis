# Shared test-code predicate excludes `*.test-support.*` from diff candidates

`isProductionFile` (`v2/src/execution/diff-scan.ts`) only rejects basenames containing `.test.`, so a changed `*.test-support.ts` becomes a mutation candidate (evidence: PR #3994, review row `9eceeccb`). The import guard's `isProductionSourceFile` (`scripts/production-files.ts`) classifies test code separately; the two can drift.

## Decisions

- Add one exported basename predicate `isTestCodePath(path)` in `scripts/production-files.ts`: true when the basename ends with `.test.ts`, `.test.tsx`, or `.test-support.ts`; rules out a substring match on `.test.`/`.test-support.` anywhere in the basename, which would also exclude a hypothetical `foo.test.helpers.ts` and widen every `isProductionSourceFile` caller's scan (five guards; see below) beyond today's anchored-suffix behavior for no evidenced need.
- `isProductionSourceFile` keeps its root-prefix, `.ts/.tsx`, and `v2/src/testing/` rules and replaces only its test/test-support clauses with `isTestCodePath`; this is a pure extraction, so `scripts/guard-dead-exports.ts`, `scripts/guard-sync-child-processes.ts`, and `scripts/guard-unbounded-subprocess.ts` (the other production callers of `isProductionSourceFile`) see no change in which files they scan. `scripts/guard-real-lint-in-unit-tests.ts` and `scripts/guard-production-test-flags.ts` do not call `isProductionSourceFile` and are unaffected.
- `isProductionFile` keeps its `NON_PRODUCTION_PATTERNS` prefix list and replaces only its basename check (currently a `.test.` substring check) with `isTestCodePath`; this also excludes `*.test-support.ts` from `runtime-smoke-verifier.ts`'s diff scan (`isProductionFile` at `:134`) and `uncovered-changed-lines.ts`'s coverage-scope resolution (`isProductionFile` at `:103`) — both intended, since test-support files carry no runtime-smoke or killing-test-coverage obligation of their own; rules out limiting the predicate swap to the mutation verifier's call site alone and leaving the other two callers on the looser substring check.
- `v2/src/testing/` stays a mutation candidate; out of scope.

## Acceptance criteria

- [x] A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` asserts a diff changing only a `*.test-support.ts` file yields no mutation candidates; it fails against the pre-fix `.test.` substring check.
- [x] A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` asserts a diff changing a production file and a `*.test-support.ts` file yields a candidate only for the production file.
- [x] A new `scripts/production-files.test.ts` directly tests `isTestCodePath`: true for `foo.test.ts`, `foo.test.tsx`, and `foo.test-support.ts`; false for a plain production path and for the mid-basename case `foo.test.helpers.ts` (confirms the anchored-suffix boundary above).
- [x] `v2/src/execution/diff-scan.ts` and `scripts/production-files.ts` classify test code through the same exported `isTestCodePath` predicate, consumed by `isProductionFile` and `isProductionSourceFile` respectively.
- [x] `scripts/guard-production-test-support-imports.test.ts`, `scripts/guard-dead-exports.test.ts`, `scripts/guard-sync-child-processes.test.ts`, and `scripts/guard-unbounded-subprocess.test.ts` stay green (import-guard and structural-guard scans unchanged).
- [x] `v2/src/execution/runtime-smoke-verifier.test.ts`, `v2/src/execution/uncovered-changed-lines.test.ts`, and `v2/src/execution/diff-derived-mutation-verifier.test.ts` stay green (killing-test resolution, coverage-scope resolution, and runtime-smoke diff scan unchanged apart from the new test-support exclusion).
- [x] `bun run typecheck` and `bun run test` (full suite — the change touches `scripts/`, which `scripts/ci-test-scope.ts` always routes to `full`) pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification: `*.test.*` and `*.test-support.*` basenames are test code and never mutation candidates.
- `v2/docs/v1-behaviors.md`: `[v2-only]` entry — diff-derived mutation candidates, runtime-smoke verification, and coverage-scope resolution all exclude test-support files via the predicate shared with the import guard.
