# 01 — write-loop-intent-landing fixture

`seedGitBaseline` in `write-loop-intent-landing.test.ts` runs init/config×2/add/commit per worktree, committing whatever content the fake worktree already holds.

## Decisions

- Use the template-repo helper's uncommitted mode ([00](00-template-helper-intent-output.md)) to seed `.git` (init + identity config), then `add -A` + `commit` per test — the baseline commit must capture per-test worktree content, so a pre-committed template can't be used here.
- Baseline commit content and message (`baseline`) stay unchanged.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-intent-landing.test.ts` `seedGitBaseline` uses the template-repo helper's uncommitted mode; per-test `git init` and `git config` execs are gone.
- [x] `v2/src/execution/write-loop-intent-landing.test.ts` stays green.
- [x] `v2/src/execution/write-loop-intent-landing.test.ts` test count is unchanged or higher versus the merge base.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.
- [x] `bun run check` passes.

## Documentation updates

- `v2/docs/test-writing.md` — note the helper's uncommitted-template mode for fixtures whose baseline commit captures per-test content.
