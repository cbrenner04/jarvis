# Revert refused out-of-diff repair paths

## Problem

When `validateReadyGateRepairCompletion` (`v2/src/execution/write-loop.ts`) refuses repair edits outside the run diff and spec tree (`REPAIR_FENCE_FAILURE_MESSAGE`), the refused paths stay dirty, so `jarvis cleanup` cannot reclaim the terminal worktree.

## Decisions

- Revert only the `REPAIR_FENCE_FAILURE_MESSAGE` violation set; sidecar, load-sensitive, and markdown-only fence refusals are unchanged — rules out widening revert to fences this intent does not cover.
- Tracked modified/deleted paths restore to `HEAD` content; untracked new paths are deleted — `HEAD` is the pre-repair tree since repair edits are uncommitted at fence time; rules out `git stash` (shared stash stack) and whole-tree `git clean`.
- Failure detail keeps the `REPAIR_FENCE_FAILURE_MESSAGE` prefix and path list and appends a revert statement — existing string matchers stay valid.
- A revert that itself fails keeps today's retryable `completion_commit_failed` and says the revert failed — rules out claiming a clean tree that isn't.

## Acceptance criteria

- [ ] A new `write-loop` test drives a repair pass that modifies a tracked path and creates an untracked path outside run diff and spec tree; afterward `git status --porcelain` is empty for both (tracked restored to pre-repair content, new file deleted) and the failure detail names both paths and states they were reverted; it fails against the pre-fix leave-dirty behavior (real git worktree; fence not stubbed).
- [ ] Existing in-diff repair commit tests in `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completion-failure recovery: refused out-of-diff repair edits are reverted.
- `v2/docs/v1-behaviors.md` — record the revert.
