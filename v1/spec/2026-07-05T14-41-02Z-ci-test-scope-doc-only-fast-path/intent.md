---
name: ci-test-scope-doc-only-fast-path
---
# CI test-scope skips full suite for doc/report-only diffs

## Problem

`classifyChangedPaths` in `scripts/ci-test-scope.ts` falls back to `full` for
any path outside `v1/`, `v2/`, `shared/`, `test/` — so a diff touching only
`reports/*.md`, `v1/docs/*.md`, or `v1/spec/seeds/*.md` runs the entire test
suite instead of skipping it.

## Decisions

- Add a no-test-impact path classifier distinct from `ROOT_TOOLING_PATTERNS`
  (which must keep forcing `full`).
- A diff of only no-test-impact paths returns an empty/skip scope.
- A diff mixing no-test-impact and code paths scopes on the code paths only.

## Task checklist

- [ ] Add the no-test-impact classifier to `classifyChangedPaths`.
- [ ] Doc/report-only diffs return an empty/skip scope, not `full`.
- [ ] Mixed diffs scope on code paths, ignoring no-test-impact paths.
- [ ] Add test coverage for both cases in `ci-test-scope.test.ts`.

## Acceptance criteria

- [ ] A doc/report/seed-only PR's CI no longer runs `Test (full)`.
- [ ] Existing scoping behavior for code-touching diffs is unchanged.

## Documentation updates

- Update the CI-scoping description in `v1/docs/operator-runbook.md` § The
  gate.

## Prerequisites
