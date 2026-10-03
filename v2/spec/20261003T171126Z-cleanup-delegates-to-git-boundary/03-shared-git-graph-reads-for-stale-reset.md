# 03 — Shared git graph reads for stale-reset

## Problem

Stale-reset logic in `cleanup.ts` uses inline `merge-base --is-ancestor`, `merge-tree --write-tree`, conflict diff listing, and `git log -p` tick-backing reads, bypassing `shared/git.ts`.

## Decisions

- Add typed exports to `shared/git.ts` for: ancestor check (`isAncestor` soft boolean matching today's `merge-base --is-ancestor` with ignored stdio), merge-tree write-tree OID comparison inputs, unmerged-path listing (`diffNameOnly` with conflict filter or dedicated helper), and path-scoped `git log -p` output for `base..head` used by tick-backing (`commitBacksCheckedCriterion`, ~line 3502) — rules out leaving tick-backing on inline `runAsync("git", ["log", …, "-p"` while [06](./06-cleanup-operation-errors-and-docs.md) requires zero `runAsync("git"` in `cleanup.ts`.
- Tick-backing log read failures stay soft `false` where they do today (catch → `false`) — rules out throwing through criterion gates on log errors.
- New exports classify failures with `GitOperationError` where the boundary throws; soft boolean helpers swallow as today — rules out raw `AsyncSubprocessError` leaking from shared helpers.

## Task checklist

- Implement graph/read git exports + `shared/git.test.ts` coverage (ancestor, merge-tree, conflict paths, log-patch-for-path).
- Migrate `isDescendantOfBase`, `listRebaseConflictPaths`, merge-tree comparison inputs, and `commitBacksCheckedCriterion` off inline `git` spawns in `cleanup.ts`.

## Acceptance criteria

- [ ] `shared/git.test.ts` covers ancestor, merge-tree, conflict-path, and log-patch helpers; fails against pre-fix missing exports.
- [ ] `cleanup.test.ts` adds `tick-backing delegates log-patch read to shared git` asserting `commitBacksCheckedCriterion` no longer uses `runAsync("git", ["log"`; fails against pre-fix inline spawn (~line 3502).
- [ ] `cleanup.ts` contains no `runAsync("git", ["merge-base", "--is-ancestor"` or `["merge-tree"` or `["log",` with `-p` for tick-backing — staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
