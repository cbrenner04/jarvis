# No-test-impact path classifier

## Problem

`classifyChangedPaths` in `scripts/ci-test-scope.ts` scopes by `v1/`, `v2/`,
`shared/`, `test/` prefix and falls back to `full` for anything else. Docs and
specs under `v1/docs/`, `v1/spec/`, and `reports/` carry no test-relevant code,
but a diff touching only those paths still triggers test execution (`test:v1`
for `v1/docs|spec`, `full` for `reports/`) instead of skipping tests entirely.

## Decisions

- Add `NO_TEST_IMPACT_PATTERNS` (`^reports/`, `^v1/docs/`, `^v1/spec/`),
  checked before the `v1/`/`v2/`/`shared/`/`test/` prefix branches and after
  `ROOT_TOOLING_PATTERNS` — root-tooling still forces `full` first.
- A diff where every changed path matches `NO_TEST_IMPACT_PATTERNS` returns
  `[]` (skip scope), not `full`.
- A diff mixing no-test-impact paths with code paths ignores the
  no-test-impact paths and scopes on the code paths only, per existing rules.
- An empty `paths` array still returns `full` (unchanged defensive fallback;
  no real diff should ever reach this).

## Task checklist

- [ ] Add `NO_TEST_IMPACT_PATTERNS` and the skip branch to
      `classifyChangedPaths`.
- [ ] Doc/report-only diffs return `[]`.
- [ ] Mixed diffs scope on code paths, ignoring no-test-impact paths.
- [ ] Add test coverage in `ci-test-scope.test.ts`: doc-only diff, report-only
      diff, and a mixed doc+code diff.

## Acceptance criteria

- [ ] `resolveCiTestScope` returns `[]` for a diff of only `v1/docs/**`,
      `v1/spec/**`, and `reports/**` paths.
- [ ] `resolveCiTestScope` returns the code-scoped result (unchanged) for a
      diff mixing no-test-impact paths with `v1/`, `v2/`, or `shared/` paths.
- [ ] Existing `ci-test-scope.test.ts` cases (root-tooling, unmatched,
      unresolvable base) stay green.

## Documentation updates

- Update `v1/docs/operator-runbook.md` § The gate CI-scoping bullet to
  describe the doc/report/spec no-test-impact fast path.
