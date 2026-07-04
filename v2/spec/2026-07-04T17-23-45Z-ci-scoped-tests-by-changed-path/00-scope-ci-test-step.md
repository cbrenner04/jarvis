# Scope CI test step by changed-path detection

## Problem

`.github/workflows/ci.yml`'s `Test` step always runs `bun run test` (full
suite), ignoring the repo's own `v1`/`v2`/`shared` boundary and the
surface-scoped scripts `package.json` already exposes (`test:v1`, `test:v2`,
`test:integration:v2`, `test:shared`).

## Decisions

- Detect changed paths via `git diff --name-only` between the merge-base and
  `HEAD`, not branch-name conventions — base ref is the PR base SHA
  (`pull_request`) or the pre-push SHA (`push`).
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
- Base SHA missing, unresolvable, or no merge-base found (force-push,
  non-standard ref) → full `bun run test`, never a partial run.
- Changed paths matching root tooling (`package.json`, `tsconfig*.json`,
  `.github/workflows/**`, root `scripts/**`) → full `bun run test`.
- `shared/**` changed → both `test:v1` and `test:v2` (+ `test:integration:v2`
  per the rule above).
- `bun run typecheck`, `bun run check`, `bun run lint:md` stay unscoped.

## Acceptance criteria

- [ ] A PR/push whose diff touches only `v1/**` runs `test:v1` in CI and does
      not run `test:v2` or `test:integration:v2`.
- [ ] A PR/push whose diff touches only `v2/**` runs `test:v2` and
      `test:integration:v2` in CI and does not run `test:v1`.
- [ ] A PR/push whose diff touches only `shared/**` runs both `test:v1` and
      `test:v2` (+ `test:integration:v2`) in CI.
- [ ] A PR/push whose diff touches root tooling (`package.json`,
      `tsconfig*.json`, `.github/workflows/**`, root `scripts/**`) runs the
      full `bun run test` in CI.
- [ ] A PR/push where changed-path detection cannot resolve a merge-base
      (e.g. force-push) runs the full `bun run test` in CI, not a partial or
      skipped run.
- [ ] `bun run typecheck`, `bun run check`, and `bun run lint:md` run in full
      in CI regardless of which surface changed.

## Documentation updates

- Note the scoped-CI behavior in `v1/docs/operator-runbook.md` (why a PR's CI
  run may only show a subset of test jobs).
