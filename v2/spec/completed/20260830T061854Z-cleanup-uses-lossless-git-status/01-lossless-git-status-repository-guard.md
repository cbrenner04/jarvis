# Lossless git status inventory repository guard

Authoritative for the cross-consumer porcelain-parser guard: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

After subspec 00 migrates cleanup, nothing in the repository prevents a future reintroduction of independent `git status` porcelain path parsing in the four path-aware consumers that now share `getGitStatusInventory`.

## Decision ledger

- Land the guard only after subspec 00 merges; rules out a guard that passes while `cleanup.ts` still parses porcelain independently.
- `scripts/guard-lossless-git-status-inventory.ts` scans exactly `v2/src/execution/review-intent-enforcement.ts`, `v2/src/execution/completion-commit.ts`, `v2/src/execution/write-loop.ts`, and `v2/src/commands/cleanup.ts` for newline path-record splitting on `git status` output, status-prefix slicing, rename-arrow slicing, and path trimming; rules out a repo-wide scan that flags unrelated `git worktree list --porcelain` parsers.
- The guard inventory is explicit and fail-closed: each scanned file must either contain no forbidden constructs or be listed with a documented exemption; rules out silently permitting unknown parsing shapes.
- Guard tests use synthetic `{ file, source }` fixtures and a repository snapshot walk; rules out production inversion hooks or temp on-disk trees for shape coverage.
- Wire the guard into `bun run check` beside existing `scripts/guard-*.ts` runners; rules out a standalone script operators forget.

## Prerequisites

- [00 - Migrate stale-reset dirty listing](./00-stale-reset-inventory.md) merged.

## Tasks

- Add `scripts/guard-lossless-git-status-inventory.ts` with exported violation discovery over `{ file, source }` records plus a `cwd`-rooted walker for the four consumer files.
- Add `scripts/guard-lossless-git-status-inventory.test.ts` with rejected and allowed synthetic fixtures for each forbidden construct and a repository-walk case that fails while `cleanup.ts` still contains the pre-migration `listDirtyWorktreePathsForStaleReset` parser.
- Append the guard runner to the `check` script in `package.json` and update the pinned `check` string in `v1/test/ready-script.sandbox-unrunnable.test.ts`.
- Align `v2/docs/coding-standards.md` with enforced guard coverage of the four consumers.

## Acceptance criteria

- [x] `scripts/guard-lossless-git-status-inventory.test.ts` test `rejects independent git status porcelain path parsing` fails against the pre-migration tree where `v2/src/commands/cleanup.ts` newline-splits `git status --porcelain` output in `listDirtyWorktreePathsForStaleReset`; reachable today because that parser remains in production.
- [x] `scripts/guard-lossless-git-status-inventory.test.ts` test `allows getGitStatusInventory consumers after migration` passes when all four inventoried consumer files obtain paths only through `getGitStatusInventory` current-path projection with no forbidden constructs.
- [x] `bun run check` runs the guard and passes against the migrated tree with only the four named consumer files in scope.
- [x] `v1/test/ready-script.sandbox-unrunnable.test.ts` test `package biome scripts use bun's resolved biome binary` pins the updated `check` script string including the new guard.
- [x] `v2/docs/coding-standards.md` states that `bun run check` enforces the lossless inventory guard on the four named path-aware consumers via `scripts/guard-lossless-git-status-inventory.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — enforced lossless git status inventory guard under `bun run check`.
