# No-test-impact path classifier

## Problem

`classifyChangedPaths` in `scripts/ci-test-scope.ts` scopes by `v1/`, `v2/`,
`shared/`, `test/` prefix and falls back to `full` for anything else. Docs and
specs under `v1/docs/`, `v1/spec/`, `v2/docs/`, `v2/spec/`, and `reports/`
carry no test-relevant code, but a diff touching only those paths still
triggers test execution (`test:v1`/`test:v2` for the docs/spec paths, `full`
for `reports/`) instead of skipping tests entirely.

The existing code ends the per-path loop with
`scripts.length > 0 ? scripts : "full"`. That line already conflates two
distinct cases — an empty input `paths` array, and a non-empty `paths` array
where every path is inert — both leave `scripts` empty and both currently
return `full`. A fix that only adds a pattern-matching branch without
separating these two cases reproduces the bug.

## Decisions

- Add `NO_TEST_IMPACT_PATTERNS` (`^reports/`, `^v1/docs/`, `^v1/spec/`,
  `^v2/docs/`, `^v2/spec/` — v1 and v2 docs/specs are symmetric markdown-only
  paths), checked before the `v1/`/`v2/`/`shared/`/`test/` prefix branches and
  after `ROOT_TOOLING_PATTERNS` — root-tooling still forces `full` first.
- Mechanism: filter `paths` against `NO_TEST_IMPACT_PATTERNS` before the
  existing per-path loop, and loop over the filtered set only. Gate the
  `full` fallback on the *original* `paths` array being empty, not on
  `scripts` being empty: `paths.length === 0 → "full"` (unchanged defensive
  fallback); else `filtered.length === 0 → []` (all paths were no-test-impact);
  else run the existing loop over `filtered` and keep
  `scripts.length > 0 ? scripts : "full"` for the remaining code-path case.
- A diff mixing no-test-impact paths with code paths ignores the
  no-test-impact paths (filtered out before the loop) and scopes on the code
  paths only, per existing rules.

## Task checklist

- [ ] Add `NO_TEST_IMPACT_PATTERNS` and the pre-filter/gate mechanism above to
      `classifyChangedPaths`.
- [ ] Doc/report-only diffs return `[]`.
- [ ] Mixed diffs scope on code paths, ignoring no-test-impact paths.
- [ ] Add test coverage in `ci-test-scope.test.ts`:
  - [ ] Non-empty diff of only no-test-impact paths (doc-only, report-only,
        and a mix of v1/v2 docs+specs) → `[]`, asserted separately from the
        existing empty-`paths`-array → `full` case.
  - [ ] Mixed no-test-impact + code-path diff → scoped on the code paths only.
  - [ ] Root-tooling path mixed with no-test-impact paths → still `full`
        (pins that `ROOT_TOOLING_PATTERNS` is checked before the
        no-test-impact filter).

## Acceptance criteria

- [x] `resolveCiTestScope` returns `[]` for a non-empty diff of only
      `v1/docs/**`, `v1/spec/**`, `v2/docs/**`, `v2/spec/**`, and
      `reports/**` paths.
- [x] `resolveCiTestScope` returns the code-scoped result (unchanged) for a
      diff mixing no-test-impact paths with `v1/`, `v2/`, or `shared/` paths.
- [x] `resolveCiTestScope` returns `full` for a diff mixing a root-tooling
      path with no-test-impact paths.
- [x] Existing `ci-test-scope.test.ts` cases (root-tooling, unmatched, empty
      `paths`, unresolvable base) stay green.

## Documentation updates

- Update `v1/docs/operator-runbook.md` § The gate CI-scoping bullet to
  describe the doc/report/spec (v1 and v2) no-test-impact fast path.
