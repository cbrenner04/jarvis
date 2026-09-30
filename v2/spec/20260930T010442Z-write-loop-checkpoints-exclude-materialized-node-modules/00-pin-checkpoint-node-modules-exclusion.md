# Pin settled-iteration checkpoint `node_modules` exclusion

## Problem

`completionStageArgs` already excludes the harness-materialized worktree-root `node_modules` symlink from completion staging, and `commitSettledIteration` invokes the shared production committer with `formatMode: checkpoint`. No write-loop regression proves a settled iteration's checkpoint commit keeps that exclusion when the target `.gitignore` contains only `node_modules/` — the case where bare `git add -A` would stage the symlink and poison every later lane on the base branch.

## Decisions

- **Coverage-only (behavior-preserving):** production checkpoint staging is assumed correct on base; deliverable is regression pin plus doc alignment; the failing-test-on-pre-fix rule does not apply; rules out reviewers expecting red-then-green runtime work when wiring already satisfies the contract.
- Add a real-git settled-iteration regression in `write-loop.test.ts` that uses the default production `createCompletionCommitter()` seam (no stub committer); rules out covering exclusion only in `completion-commit.test.ts`.
- Seed the fixture with `.gitignore` containing only `node_modules/`, a directory symlink at the worktree root matching harness materialization, and a separate authored file change; rules out fixtures that inherit jarvis-repo ignore rules or omit the ignore-only staging hazard.
- Assert the checkpoint commit tree includes the authored path and introduces no `node_modules` path; pair with a `// Mutation checkpoint:` comment in the new test (same pattern as existing `write-loop.test.ts` pins) that narrowing `completionStageArgs` in `v2/src/execution/completion-commit.ts` to bare `git add -A` must turn the test red; rules out an unfalsifiable AC with no reachable regression hook.
- If the new write-loop test fails on base, in-scope work includes fixing `commitSettledIteration` / committer wiring until the pin passes; rules out a stranded implement run with no authorized scope expansion when base wiring is wrong.
- Scope is regression pin plus doc alignment, not a second staging implementation in `write-loop.ts`, when the test passes without code changes; rules out duplicating `completionStageArgs` logic in the write loop.
- Extend `write-behavior.md` in the per-iteration checkpoint paragraph to state explicitly that checkpoint commits inherit the harness-owned `node_modules` exclusion from `completionStageArgs`; rules out duplicating the full pathspec contract already under **Completion-staging exclusions**.
- Amend the existing `v1-behaviors.md` **v2 external worktree `node_modules` symlink** parity bullet to name settled-iteration checkpoint commits explicitly; rules out a second parallel bullet that duplicates completion-staging prose already in that entry.

## Task checklist

- [ ] Add `write-loop.test.ts` coverage that drives one settled main-loop iteration through `checkpointSettledIteration` / `commitSettledIteration` with the production committer, the ignore-only fixture, materialized symlink, and authored change; assert `iteration_commit` carries a fresh `commitSha` whose tree matches the contract.
- [ ] Add a `// Mutation checkpoint:` comment on the new test tying failure to narrowing `completionStageArgs` in `v2/src/execution/completion-commit.ts` to bare `git add -A` (established `write-loop.test.ts` inversion pattern).
- [ ] Update `v2/docs/write-behavior.md` per **Documentation updates**.
- [ ] Update `v2/docs/v1-behaviors.md` per **Documentation updates**.

## Acceptance criteria

**Coverage-only:** behavior on base is assumed correct; criteria verify regression, preservation, and docs — not a mandatory pre-fix failing test.

- [x] `v2/src/execution/write-loop.test.ts` test `settled iteration checkpoint omits harness-materialized node_modules symlink` drives a real settled iteration through the production checkpoint committer with `.gitignore` containing only `node_modules/`, a materialized worktree-root `node_modules` symlink, and an authored change; the resulting commit contains the authored change and no new `node_modules` path, and fails when `completionStageArgs` is narrowed to bare `git add -A` (reachable on `v2/src/execution/completion-commit.ts`).
- [x] `v2/src/execution/completion-commit.test.ts` tests `a real untracked node_modules directory is still committed` and `a node_modules symlink already tracked at HEAD survives the completion commit` stay green.
- [x] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` document checkpoint inheritance of the `node_modules` exclusion without duplicating the full staging pathspec contract.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — in the per-iteration checkpoint section, state explicitly that settled-iteration checkpoint commits use the same `completionStageArgs` harness-owned `node_modules` exclusion as terminal completion commits.
- `v2/docs/v1-behaviors.md` — amend the existing **v2 external worktree `node_modules` symlink** bullet so settled-iteration checkpoint commits omit untracked harness-materialized worktree-root `node_modules` symlinks under the same narrow staging contract as completion commits (do not add a second parallel bullet).
