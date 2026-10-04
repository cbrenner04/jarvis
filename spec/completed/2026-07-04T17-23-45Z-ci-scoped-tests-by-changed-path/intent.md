---
name: ci-scoped-tests-by-changed-path
---

# CI runs only the test suite(s) for the surface(s) a PR/push actually changed

## Problem

`.github/workflows/ci.yml` always runs `bun run test` (the full suite), even
though `package.json` already exposes surface-scoped scripts (`test:v1`,
`test:v2`, `test:integration:v2`, `test:shared`). A PR touching only
`v2/src/**` still waits on the full v1 suite, and vice versa, ignoring the
repo's own `v1`/`v2`/`shared` boundary.

## Scope

- Detect changed top-level surface(s) from the actual PR/push diff (e.g.
  `git diff --name-only` against the merge-base), not branch-name
  conventions.
- Run only the matching scoped script(s):
  - `v1/**` changed → `test:v1`.
  - `v2/**` changed → `test:v2` (confirm in plan whether
    `test:integration:v2` is already part of the full-suite baseline and
    should run alongside it).
  - `shared/**` changed → both `test:v1` and `test:v2`.
  - Root tooling changed (`package.json`, `tsconfig*.json`,
    `.github/workflows/**`, root `scripts/`) → full `bun run test`, as a
    safe default.
  - Changed-file detection fails or is ambiguous (e.g. force-push,
    non-standard ref) → full `bun run test`; never skip a surface by
    mistake.
- `bun run typecheck`, `bun run check` (Biome), and `bun run lint:md` stay
  unscoped, running in full regardless of changed surface.

## Out of scope

- Changing the meaning or contents of `test:v1`/`test:v2`/`test:shared`.
- Local developer workflow — `bun run test` run by hand stays full.
- Plan mode — `jarvis1 plan`/`jarvis1 intent` do not run tests today and
  must not start.
- Patch-mode implementing-agent instructions (separate intent).

## Documentation updates

- Note the scoped-CI behavior (e.g. in `v1/docs/operator-runbook.md` or
  root `AGENTS.md`) so contributors understand why a PR's CI run may only
  show a subset of test jobs.

## Prerequisites

- package.json exposes surface-scoped test scripts (test:v1, test:v2, test:integration:v2, test:shared)
