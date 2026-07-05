---
name: ci-test-scope-doc-only-fast-path
---
# CI test-scope falls back to `full` for doc/report-only diffs

## Problem

`scripts/ci-test-scope.ts`'s `classifyChangedPaths` only recognizes `v1/`,
`v2/`, `shared/`, `test/` path prefixes; any other changed path (e.g.
`reports/*.md`, `reports/*.csv`) hits the `else { return "full" }` branch and
runs the entire test suite (`test:v1` + `test:integration:v1` + `test:v2` +
`test:integration:v2` + `test:shared` + `test:integration:shared`). A
docs/report/seed-only PR that touches zero test-relevant code still pays the
full-suite cost and wall-clock time — observed 2026-07-05: a PR touching only
`reports/**`, `v1/docs/operator-runbook.md`, and `v1/spec/seeds/*.md` ran
`Test (full)` instead of a scoped (or skipped) subset.

## Decisions

- Extend `classifyChangedPaths` with a "no test impact" path set — `reports/`,
  and other purely-documentary root paths already excluded from `lint:md`'s
  test-relevance globs are a starting reference, though `lint:md`'s globs
  (`v1/spec/**`, `v1/docs/**`, `reports/**`, `README.md`, `AGENTS.md`) are
  about markdown *linting*, not test *scope* — decide independently which
  paths are safe to treat as zero test impact for scoping purposes.
- A diff containing *only* no-test-impact paths should skip the test job
  entirely (or run nothing) rather than fall back to `full`.
- A diff mixing no-test-impact paths with `v1/`/`v2/`/`shared/`/`test/` paths
  should scope normally on the code paths, ignoring the no-test-impact ones
  (don't let their presence force a `full` fallback).
- `ROOT_TOOLING_PATTERNS` (package.json, tsconfig, `.github/`, `scripts/`)
  should keep forcing `full` — those genuinely can affect anything.

## Task checklist

- [ ] Add a no-test-impact path classifier to `classifyChangedPaths`
      (`scripts/ci-test-scope.ts`), distinct from `ROOT_TOOLING_PATTERNS`.
- [ ] A diff of only no-test-impact paths returns an empty/skip scope, not
      `full`.
- [ ] A diff mixing no-test-impact and code paths scopes on the code paths
      only.
- [ ] Add test coverage for both cases in `ci-test-scope.test.ts` (or
      equivalent).

## Acceptance criteria

- [ ] A doc/report/seed-only PR's CI no longer runs `Test (full)`.
- [ ] Existing scoping behavior for code-touching diffs is unchanged.

## Documentation updates

- Update the CI-scoping description in `v1/docs/operator-runbook.md` § The
  gate once this lands.
