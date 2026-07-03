# 00 - Extract sandbox git repo fixture

`external-worktree.sandbox-unrunnable.test.ts` inlines a `setupRepo()` helper that spawns real `git init`/`config`/`commit`. Move it to a shared, clearly sandbox-scoped fixture so no agent-runnable test can import real-git setup by accident.

## Decisions

- New fixture file name carries a sandbox-only marker (e.g. `sandbox-git-repo.ts`, not `git-repo.ts`) — rules out an agent-runnable test importing it by mistake.
- `getLockRoot` stays file-local in the test — rules out exporting it before a second consumer exists.
- Migrated test uses `trackedTempRoots()` from `v2/src/testing/write-fixtures.ts` for cleanup instead of its own `afterEach`/`roots` array — rules out a second local cleanup pattern.
- Fixture returns the same `{ repoRoot, jarvisRoot }` shape `setupRepo()` returned — rules out touching call sites beyond the import.

## Task checklist

- [ ] Add `v2/src/testing/sandbox-git-repo.ts` exporting a `setupSandboxGitRepo()` function with the real `git init`/`config`/`commit` sequence, returning `{ repoRoot, jarvisRoot }`, and file allocated under a tracked temp root.
- [ ] Update `external-worktree.sandbox-unrunnable.test.ts` to import and call the new fixture in place of its local `setupRepo()`, and to use `trackedTempRoots()` for cleanup.
- [ ] Add a top-of-file comment on the new fixture file stating it must only be imported from `.sandbox-unrunnable.test.ts` files.

## Acceptance criteria

- [ ] `external-worktree.sandbox-unrunnable.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/src/testing/sandbox-git-repo.ts` exists, is the sole real-`git`-spawning fixture under `v2/src/testing/`, and is imported only by `.sandbox-unrunnable.test.ts` files.
- [ ] `bun run test:v2` (agent-runnable slice) does not import or transitively load the new fixture.

## Documentation updates

- `v2/docs/test-writing.md`: add the new fixture to the shared-fixtures list (alongside `write-fixtures.ts`, `run-control.ts`), naming it as sandbox-only and warning agent-runnable tests not to import it.
