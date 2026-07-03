# Extract shared write-test fixtures

`v2/src/execution/write.test.ts` and `write-loop.test.ts` each hand-roll their own
temp-root cleanup, Jarvis-home setup, and fake `withExternalWorktree`. Extract shared
fixtures under `v2/src/testing/` so both files consume the same code without changing
what either file tests.

## Decisions

- Extract a `createJarvisHome()` fixture returning `{ jarvisRoot, stateDbPath }` with
  `stateDbPath` always populated (a deterministic path under `jarvisRoot`, unopened) —
  rules out a separate no-state-db variant, since an unopened path is free for the
  caller that doesn't need it (`write.test.ts`).
- Extract `createFakeWithExternalWorktree(jarvisRoot?)` as one factory accepting an
  optional default `jarvisRoot` and tracking per-worktree "reused" state via the
  on-disk `.reused` marker (write-loop.test.ts's richer behavior) — rules out keeping
  `write.test.ts`'s simpler always-`reused: false` variant as a separate fake, since
  the marker-file check degrades correctly to `reused: false` on a fresh worktree.
- Extract a `trackedTempRoots()` helper returning `{ roots, cleanup }` (or an
  `afterEach`-registering helper) that both files call once instead of maintaining
  their own `roots: string[]` array and manual splice/rmSync loop — rules out each
  file keeping its own cleanup loop.
- Keep `write-loop.test.ts`'s scenario matrix (test cases, assertions, counts)
  unchanged — rules out merging or dropping cases during the migration.
- No production code changes — rules out folding `withExternalWorktree` or Jarvis-home
  path resolution from `v2/src/execution/*.ts` into this refactor.

## Task checklist

- [ ] Add `v2/src/testing/write-fixtures.ts` (or similarly named module) exporting the
      Jarvis-home fixture, the fake external-worktree factory, and the temp-root
      cleanup helper.
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
      import them from `v2/src/testing/`.

## Documentation updates

- `v2/docs/test-writing.md`: add a line alongside the existing shared-socket-fixture
  and run-control-helper entries pointing to the new shared temporary-root,
  Jarvis-home, and fake external-worktree fixtures in `v2/src/testing/`.
