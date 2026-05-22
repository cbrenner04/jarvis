# 00 - GitHub Actions CI

## Problem

Contributors and future PRs should get the same verification as local
development (`typecheck`, tests, Biome) without relying on a maintainer’s
machine.

## Decisions

- **Trigger**: `push` to `main` and all `pull_request` activity so every PR is
  exercised before merge.
- **Runner**: `ubuntu-latest`.
- **Runtime**: Bun via `oven-sh/setup-bun` with `bun install --frozen-lockfile`
  so CI matches the committed lockfile.
- **Commands**: `bun run typecheck`, `bun run test`, `bun run check` (Biome),
  matching `package.json` scripts.

## Tasks

- [x] Add `.github/workflows/ci.yml` with a single job (recommended job id:
      `checks`) so required-status-check names stay predictable; confirm the
      branch-protection context with `commits/main/check-runs` (this repo uses
      **`checks`**).
- [x] Confirm the workflow passes on a clean checkout.

## Acceptance criteria

- Opening a PR against this repo runs the workflow and fails if typecheck,
  tests, or Biome check fail.

## Documentation updates

- [x] In [../../README.md](../../README.md), add a short **CI** subsection under
      **Installation** or **Contributing** pointing at `.github/workflows/ci.yml`
      and listing the commands CI runs.
