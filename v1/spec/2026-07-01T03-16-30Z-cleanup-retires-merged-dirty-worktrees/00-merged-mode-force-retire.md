# Merged-mode force-retire

## Problem

Merged-mode `jarvis1 cleanup` skips worktrees with uncommitted or unpushed
changes even when the matching PR is merged. Scoped `jarvis1 cleanup --abandon
<name>` correctly refuses merged PRs. A merged-but-dirty plan worktree (review
actuator or mid-run kill) has no harness retire path.

## Behavior

Default merged-mode `jarvis1 cleanup` (no `--abandon`) retires worktrees whose
branch PR is `MERGED` even when `hasDirtyStatus` is true. Stale local edits are
discarded. Not-merged worktrees with dirty porcelain or unpushed commits keep
the existing skip line.

`--abandon` (global and scoped) is unchanged.

## Decisions

- Merged-mode retire uses `git worktree remove --force` + `deleteMergedBranch` when `isMergedPr` is true, regardless of porcelain — rules out non-force remove on dirty trees and rules out leaving merged worktrees on disk.
- Dirty-skip guard stays when `isMergedPr` is false — rules out discarding in-flight uncommitted work on open/closed/non-merged branches.
- `isMergedPr` false on `gh` inspection failure keeps silent skip (worktree not listed for removal) — rules out force-remove when merge status is unknown.
- `--abandon` eligibility and scoped merged-PR refusal unchanged — rules out widening abandon to merged PRs.
- Deferred to first consumer: whether to warn/log about discarded local edits before force-remove — pin when CLI UX is drafted.

## Tasks

- [ ] In `v1/src/commands/cleanup.ts` merged-mode scan: when `isMergedPr(branch)` is true, enqueue for removal without `hasDirtyStatus` gate; use `git worktree remove --force` on the retire step (or a shared helper) for merged removals.
- [ ] Tests in `v1/test/cleanup-command.sandbox-unrunnable.test.ts`: merged + uncommitted porcelain; merged + unpushed commits; merged plan worktree (`plan/*`); not-merged + dirty still skips.
- [ ] Triage suggested-moves rule 4 (`modified`/`mixed` + `MERGED`): replace `stash && jarvis1 cleanup` with direct `jarvis1 cleanup` in `v1/src/commands/triage.ts`.
- [ ] Update `v2/docs/v1-behaviors.md` cleanup entry.
- [ ] Update `v1/docs/operator-runbook.md` end-of-session cleanup (merged-but-dirty needs no manual `git worktree remove --force`).
- [ ] Update `v1/docs/worktrees-and-commits.md` triage rule 4 text to match.

## Acceptance criteria

- [ ] Merged-mode `jarvis1 cleanup` removes a worktree whose PR is merged when the worktree has uncommitted tracked or untracked changes (porcelain non-empty): worktree path gone, local branch deleted, stdout does not contain `skipping <name>: has uncommitted or unpushed changes`.
- [ ] Merged-mode cleanup removes a merged worktree with unpushed commits (`git log @{u}..` non-empty, upstream present): worktree path gone, local branch deleted, no dirty skip line.
- [ ] Merged-mode cleanup removes a dirty merged plan worktree (`.worktree/plan-<name>/`, branch `plan/<name>`, `isMergedPr` true): worktree path gone, local `plan/<name>` branch deleted.
- [ ] Not-merged worktree with uncommitted changes is skipped with stdout `skipping <name>: has uncommitted or unpushed changes` and remains on disk after declined or completed cleanup with no matching merged entries.
- [ ] `jarvis1 cleanup --abandon <name>` on a merged PR still refuses stderr `cannot abandon <name>: branch <branch> PR is merged`, exits `1`, and makes no changes (`cleanup-command.sandbox-unrunnable.test.ts` scoped merged guard stays green).
- [ ] Global `jarvis1 cleanup --abandon` behavior unchanged (`cleanup-command.sandbox-unrunnable.test.ts` global abandon tests stay green).
- [ ] Named triage on a dirty merged worktree suggests `jarvis1 cleanup` for discard (no `stash` prerequisite).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — merged-mode cleanup force-retires merged-but-dirty worktrees; dirty-skip stays for not-merged; `--abandon` unchanged.
- `v1/docs/operator-runbook.md` — end-of-session cleanup: merged-but-dirty worktrees retire via `jarvis1 cleanup`; drop any manual `git worktree remove --force` workaround for this case.
- `v1/docs/worktrees-and-commits.md` — triage suggested-moves rule 4: merged + dirty → `jarvis1 cleanup` without stash.
