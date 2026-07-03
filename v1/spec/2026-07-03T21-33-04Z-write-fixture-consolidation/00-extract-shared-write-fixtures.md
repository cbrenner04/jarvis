# Extract shared write-test fixtures

`v2/src/execution/write.test.ts` and `write-loop.test.ts` each hand-roll their own
temp-root cleanup, Jarvis-home setup, and fake `withExternalWorktree`. Extract shared
fixtures under `v2/src/testing/` so both files consume the same code without changing
what either file tests.

## Decisions

- `v2/src/testing/write-fixtures.ts` exports exactly three symbols:
  `createJarvisHome`, `createFakeWithExternalWorktree`, `trackedTempRoots` —
  pins names/module so the AC below is mechanically checkable.
- `createJarvisHome()` returns `{ jarvisRoot, stateDbPath }` with `stateDbPath`
  always populated (a deterministic path under `jarvisRoot`, unopened); this
  supersedes the intent's "optional state DB path" — rules out a separate
  no-state-db variant, since an unopened path is free for the caller that
  doesn't need it (`write.test.ts`).
- `createFakeWithExternalWorktree(jarvisRoot?)` is one factory accepting an
  optional default `jarvisRoot` and tracking per-worktree "reused" state via the
  on-disk `.reused` marker (write-loop.test.ts's richer behavior) — rules out
  keeping `write.test.ts`'s simpler always-`reused: false` variant as a separate
  fake. Verified, not assumed: task checklist below confirms the marker check
  reproduces both files' existing `reused` behavior exactly.
- `trackedTempRoots()` returns `{ roots, cleanup }` (or an `afterEach`-registering
  helper) that both files call once instead of maintaining their own
  `roots: string[]` array and manual splice/rmSync loop — rules out each file
  keeping its own cleanup loop.
- Neither fixture spawns a real subprocess or real git worktree — both fake the
  worktree filesystem state only (per v2 test-writing conventions: agent-runnable
  tests avoid real process spawn when subprocesses are incidental).
- Keep `write-loop.test.ts`'s scenario matrix (test cases, assertions, counts)
  unchanged — rules out merging or dropping cases during the migration.
- No production code changes — rules out folding `withExternalWorktree` or Jarvis-home
  path resolution from `v2/src/execution/*.ts` into this refactor.

## Task checklist

- [ ] Diff the two existing Jarvis-home setups (config content, scaffolding)
      in `write.test.ts` and `write-loop.test.ts` beyond `stateDbPath`; reconcile
      any other divergence into `createJarvisHome()` rather than dropping it.
- [ ] Diff the two existing `reused`-tracking behaviors; confirm (or adjust)
      that the unified `createFakeWithExternalWorktree` marker-file check
      reproduces both exactly.
- [ ] Add `v2/src/testing/write-fixtures.ts` exporting `createJarvisHome`,
      `createFakeWithExternalWorktree`, and `trackedTempRoots`.
- [ ] Migrate `write.test.ts` to the shared fixtures, deleting its local
      `setupRepo`, `createFakeWithExternalWorktree`, and `roots`/`afterEach` block.
- [ ] Migrate `write-loop.test.ts` to the shared fixtures the same way, preserving
      every existing test case and assertion.

## Acceptance criteria

- [ ] `write.test.ts` stays green using the shared fixtures (same test cases, same
      assertions).
- [ ] `write-loop.test.ts` stays green using the shared fixtures (same test cases,
      same assertions, unchanged scenario matrix).
- [ ] Neither test file defines its own `roots: string[]` cleanup loop,
      `setupRepo`/Jarvis-home helper, or `createFakeWithExternalWorktree` — both
      import `createJarvisHome`, `createFakeWithExternalWorktree`, and
      `trackedTempRoots` from `v2/src/testing/write-fixtures.ts`.
- [ ] After each migrated test file's suite runs, no temp directories allocated
      via `trackedTempRoots()` remain on disk (cleanup helper actually removes
      them, not just an absent local loop).

## Documentation updates

- `v2/docs/test-writing.md`: add a line alongside the existing shared-socket-fixture
  and run-control-helper entries pointing to the new shared temporary-root,
  Jarvis-home, and fake external-worktree fixtures in `v2/src/testing/`.
