# Scope CI test step by changed-path detection

## Problem

`.github/workflows/ci.yml`'s `Test` step always runs `bun run test` (full
suite), ignoring the repo's own `v1`/`v2`/`shared` boundary and the
surface-scoped scripts `package.json` already exposes (`test:v1`, `test:v2`,
`test:integration:v2`, `test:shared`).

## Decisions

- Detect changed paths via `git diff --name-only <base>...HEAD` (three-dot,
  merge-base form), not branch-name conventions — `<base>` is
  `github.event.pull_request.base.sha` for `pull_request` and
  `github.event.before` for `push`.
- `push` to `main` (this repo's only trunk push trigger) always runs the full
  `bun run test`, ignoring changed-path scoping — a safety net so two
  independently-scoped PRs that are each individually safe can't combine into
  a trunk break neither touched alone. Scoping applies only to
  `pull_request` runs.
- `actions/checkout` needs `fetch-depth: 0` — the default shallow clone has no
  history to compute a merge-base against.
- `bun run test` (`bun test --parallel`, no path) already walks every
  `*.test.ts` under the repo, so it already covers what `test:v2` +
  `test:integration:v2` cover together — confirmed by reading
  `scripts/run-v2-tests.ts` and the `.sandbox-unrunnable.test.ts` naming
  (those files still run under the bare `bun test` walk; only individual
  cases self-skip via `test.skipIf` when the sandbox lacks socket support).
  A `v2/**`-only change therefore runs both `test:v2` and
  `test:integration:v2`, to match full-suite coverage.
- Base SHA missing, empty (`0000000000000000000000000000000000000000`, which
  GitHub sends for a new branch's first push and some force-push cases), or
  no merge-base resolvable against it → treated as unresolvable → full
  `bun run test`, never a partial run.
- Changed paths matching root tooling (`package.json`, `tsconfig*.json`,
  `.github/workflows/**`, root `scripts/**`) → full `bun run test`.
- `shared/**` changed → both `test:v1` and `test:v2` (+ `test:integration:v2`
  per the rule above).
- Any changed path matching none of `v1/**`, `v2/**`, `shared/**`, or a
  recognized root-tooling pattern (e.g. a root `README.md` edit) → full
  `bun run test` — fail-safe catch-all, not just the two narrower escape
  hatches above.
- Changed-path → scripts-to-run classification lives in a standalone,
  unit-testable script (`scripts/ci-test-scope.ts`) taking changed paths and
  base-SHA resolvability as input and printing the scoped script name(s) (or
  `full`); `ci.yml` shells out to it. This makes classification testable via
  `bun run test` instead of only by observing live Actions runs.
- Single `Test` job with a conditional step per scoped script (not separate
  filtered jobs) — keeps one stable required-status-check name regardless of
  which scripts actually run, so branch protection isn't left pointing at a
  job that can be skipped.
- `bun run typecheck`, `bun run check`, `bun run lint:md` stay unscoped.

## Acceptance criteria

- [x] `scripts/ci-test-scope.ts` has a unit test file covering: `v1/**`-only,
      `v2/**`-only, `shared/**`-only, root-tooling, unmatched-path (e.g. root
      `README.md`), combined `v1/**`+`v2/**`, and unresolvable-base
      (missing/all-zeros/no-merge-base) inputs, each asserting the returned
      scoped-script set; runs via `bun run test`.
- [ ] A PR whose diff touches only `v1/**` runs `test:v1` in CI and does not
      run `test:v2` or `test:integration:v2`.
- [ ] A PR whose diff touches only `v2/**` runs `test:v2` and
      `test:integration:v2` in CI and does not run `test:v1`.
- [ ] A PR whose diff touches only `shared/**` runs both `test:v1` and
      `test:v2` (+ `test:integration:v2`) in CI.
- [ ] A PR whose diff touches both `v1/**` and `v2/**` (no `shared/**`) runs
      `test:v1`, `test:v2`, and `test:integration:v2` in CI.
- [ ] A PR whose diff touches root tooling (`package.json`, `tsconfig*.json`,
      `.github/workflows/**`, root `scripts/**`) runs the full
      `bun run test` in CI.
- [ ] A PR whose diff touches a path matching none of `v1/**`, `v2/**`,
      `shared/**`, or root tooling (e.g. a root `README.md` edit) runs the
      full `bun run test` in CI.
- [ ] A PR where changed-path detection cannot resolve a base (missing,
      all-zeros, or no merge-base found, e.g. force-push) runs the full
      `bun run test` in CI, not a partial or skipped run.
- [ ] A `push` to `main` always runs the full `bun run test` in CI,
      regardless of which paths changed.
- [x] The `Test` job keeps one stable job name whether it runs scoped or
      full tests, so branch-protection required-status-checks aren't left
      pointing at a job that can be skipped.
- [x] `bun run typecheck`, `bun run check`, and `bun run lint:md` run in full
      in CI regardless of which surface changed.

## Blocker

Implementation is complete: `scripts/ci-test-scope.ts` + unit tests cover
every path/base scenario, and `ci.yml`'s per-script conditional steps
(traced by hand against each scenario's script output) wire up correctly.
The remaining 8 criteria describe behavior observed in *live* GitHub Actions
runs across PRs with different diffs (v1-only, v2-only, shared-only, root
tooling, unmatched path, unresolvable base, push-to-main) — not verifiable
from this sandboxed iteration (no GitHub Actions execution access, and this
PR's own CI run only exercises one diff/scenario). Needs operator
confirmation via real PR runs, or an explicit decision to accept
unit-test + code-trace evidence as sufficient and close these out by hand.

## Documentation updates

- Note the scoped-CI behavior in `v1/docs/operator-runbook.md` (why a PR's CI
  run may only show a subset of test jobs).
