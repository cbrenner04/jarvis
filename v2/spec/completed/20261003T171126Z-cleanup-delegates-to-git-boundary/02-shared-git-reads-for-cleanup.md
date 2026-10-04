# 02 — Shared git reads for cleanup spec-at-ref paths

## Problem

Cleanup reads committed spec trees via inline `git ls-tree`, `git show`, `git rev-list --count`, and `git for-each-ref`, bypassing `shared/git.ts` and duplicating buffer/error handling.

## Decisions

- Add typed query exports to `shared/git.ts` only for shapes cleanup exercises today: listing tree children at `ref:path`, recursive path listing under a prefix, reading blob bytes at `ref:path`, counting commits in `base..head`, and listing local `refs/heads` short names with OIDs — rules out a generic `runGitQuery(argv)` escape hatch.
- Deferred to first consumer: porcelain formats beyond what cleanup reads — pin when a second caller needs the same ls-tree mode.
- `readGitFileAtRef` and `specTreeFsAtRef` use the new blob/tree helpers; missing objects stay soft `undefined` where they do today — rules out throwing through eligibility gates on absent paths.
- `openInRepoSpecDirNamesOnRef` and `committedBlobIdsAtRef` callers inside `cleanup.ts` use tree listings from the boundary; `committedBlobIdsAtRef` implementation may remain in `cleanup-archive-publication.ts` until a later intent — this subspec only requires `cleanup.ts` call sites that still inline `git` for those reads to delegate.
- New exports classify failures with `GitOperationError` and existing `ref-query` / `diff` operations where applicable — rules out raw `AsyncSubprocessError` leaking from shared helpers.

## Task checklist

- Implement shared/git read helpers + unit tests in `shared/git.test.ts`.
- Migrate `openInRepoSpecDirNamesOnRef`, `specTreeFsAtRef`, `readGitFileAtRef`, `resolveStaleResetRef` (`resolveRef`), ahead-count helpers, and `listLocalHeads` in `cleanup.ts`.
- Add `cleanup.test.ts` coverage that spies on or mocks shared git read exports for a stranded-spec / in-repo ready-intent path that lists or shows at a branch ref.

## Acceptance criteria

- [x] `shared/git.test.ts` adds cases for the new read helpers (tree listing, blob read, commit count, local heads); at least one fails against the pre-fix boundary missing those exports.
- [x] `cleanup.test.ts` adds `delegates spec-at-ref reads to shared git tree/blob operations` (or extends an in-repo ready-intent / stranded-spec test) asserting `cleanup.ts` no longer spawns `git show` / `git ls-tree` for that path; fails against pre-migration inline spawns in `specTreeFsAtRef` / `openInRepoSpecDirNamesOnRef`.
- [x] `cleanup.ts` contains no `runAsync("git", ["show"` or `["ls-tree"` or `["for-each-ref"` or `["rev-list", "--count"` — staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [x] `bun run typecheck`, `bun run test:shared`, and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
