# 00 - Extract sandbox git repo fixture

`external-worktree.sandbox-unrunnable.test.ts` inlines a `setupRepo()` helper that spawns real `git init`/`config`/`commit`. Move it to a shared, clearly sandbox-scoped fixture so no agent-runnable test can import real-git setup by accident.

## Decisions

- New fixture file name carries a sandbox-only marker (e.g. `sandbox-git-repo.ts`, not `git-repo.ts`) — rules out an agent-runnable test importing it by mistake.
- `getLockRoot` stays file-local in the test — rules out exporting it before a second consumer exists. Order: test calls `trackedTempRoots()` first, then `setupSandboxGitRepo(roots)`, then derives the lock root from the returned `jarvisRoot` via `getLockRoot(jarvisRoot)` — same order `setupRepo()`/`getLockRoot()` run in today, so lock-path derivation is unaffected by the extraction.
- `setupRepo`/`getLockRoot` have no other consumers (grep-confirmed, file-local to this one test file) — no cross-test lifetime dependency to preserve.
- Confirmed fit: `trackedTempRoots()` (`v2/src/testing/write-fixtures.ts`) returns `{ roots, cleanup }` and registers `cleanup` in `afterEach`, matching the test's current local `roots`/`afterEach` pattern exactly — migrated test uses it instead of its own array.
- Fixture takes the `roots: string[]` array from `trackedTempRoots()` as a parameter and pushes its allocated temp root onto it (same allocate-then-push sequence `setupRepo()` uses today) — rules out the fixture managing its own tracked-root instance.
- Fixture returns the same `{ repoRoot, jarvisRoot }` shape `setupRepo()` returned — rules out touching call sites beyond the import.

## Task checklist

- [ ] Add `v2/src/testing/sandbox-git-repo.ts` exporting `setupSandboxGitRepo(roots: string[])`, mirroring `setupRepo()`'s body: `mkdtempSync` into `roots`, then the real `git init`/`config`/`commit` sequence, returning `{ repoRoot, jarvisRoot }`.
- [ ] Update `external-worktree.sandbox-unrunnable.test.ts` to call `const { roots } = trackedTempRoots()` in place of its local `roots`/`afterEach`, drop its local `setupRepo()`, and call `setupSandboxGitRepo(roots)` at each former `setupRepo()` call site. Leave `getLockRoot` in place, called after `setupSandboxGitRepo` as today.
- [ ] Add a top-of-file comment on the new fixture file stating it must only be imported from `.sandbox-unrunnable.test.ts` files.

## Acceptance criteria

- [ ] `external-worktree.sandbox-unrunnable.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/src/testing/sandbox-git-repo.ts` exists, is the sole real-`git`-spawning fixture under `v2/src/testing/`, and is imported only by `.sandbox-unrunnable.test.ts` files.
- [ ] `bun run test:v2` (agent-runnable slice) does not import or transitively load the new fixture.

## Documentation updates

- `v2/docs/test-writing.md`: add the new fixture to the shared-fixtures list (alongside `write-fixtures.ts`, `run-control.ts`), naming it as sandbox-only and warning agent-runnable tests not to import it.
