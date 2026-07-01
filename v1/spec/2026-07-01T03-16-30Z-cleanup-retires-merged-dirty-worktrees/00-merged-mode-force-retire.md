# Merged-mode force-retire

## Problem

Merged-mode `jarvis1 cleanup` skips worktrees with uncommitted or unpushed
changes even when the matching PR is merged. Scoped `jarvis1 cleanup --abandon
<name>` correctly refuses merged PRs. A merged-but-dirty plan worktree (review
actuator or mid-run kill) has no harness retire path.

## Behavior

Default merged-mode `jarvis1 cleanup` (no `--abandon`) retires worktrees whose
branch PR is `MERGED` even when `hasDirtyStatus` is true. Stale local edits are
discarded. Not-merged worktrees exit the merged-mode scan at the merge gate
(silent non-removal: absent from preview, not force-removed).

`--abandon` (global and scoped) is unchanged.

## Decisions

- Merged-mode retire uses `git worktree remove --force` + `deleteMergedBranch` when `isMergedPr` is true, regardless of porcelain — rules out non-force remove on dirty trees and rules out leaving merged worktrees on disk.
- Not-merged worktrees exit at merge gate without dirty inspection — rules out discarding in-flight uncommitted work on open/closed/non-merged branches.
- `isMergedPr` false on `gh` inspection failure keeps silent skip (worktree not listed for removal) — rules out force-remove when merge status is unknown.
- `--abandon` eligibility and scoped merged-PR refusal unchanged — rules out widening abandon to merged PRs.
- Triage rule 4 covers `modified`/`mixed`/`untracked-only` + `MERGED` dirty porcelain → direct `jarvis1 cleanup` (no stash) — rules out leaving untracked-only merged orphans on generic fallback.
- Deferred to first consumer: whether to warn/log about discarded local edits before force-remove — pin when CLI UX is drafted.

## Tasks

- [ ] In `v1/src/commands/cleanup.ts` merged-mode scan: when `isMergedPr(branch)` is true, enqueue for removal without `hasDirtyStatus` gate; use `git worktree remove --force` on the retire step (or a shared helper) for merged removals.
- [ ] Tests in `v1/test/cleanup-command.sandbox-unrunnable.test.ts`: merged + uncommitted porcelain; merged + unpushed commits; merged plan worktree (`plan/*`); merged-but-dirty `--dry-run` preview listing; not-merged + dirty silent non-removal.
- [ ] Triage suggested-moves rule 4 (`modified`/`mixed`/`untracked-only` + `MERGED`): replace `stash && jarvis1 cleanup` with direct `jarvis1 cleanup` in `v1/src/commands/triage.ts`.
- [ ] Tests in `v1/test/triage-command.test.ts`: rule 4 modified/mixed + `MERGED` suggest `jarvis1 cleanup` without `stash`; `untracked-only` + `MERGED` (no spec path) same.
- [ ] Update `v2/docs/v1-behaviors.md` cleanup and triage rule 4 entries.
- [ ] Update `v1/docs/operator-runbook.md` end-of-session cleanup: merged-but-dirty plan worktrees retire via `jarvis1 cleanup`.
- [ ] Update `v1/docs/worktrees-and-commits.md` triage rule 4 text to match.

## Acceptance criteria

- [x] Merged-mode `jarvis1 cleanup` removes a worktree whose PR is merged when the worktree has uncommitted tracked or untracked changes (porcelain non-empty): worktree path gone, local branch deleted, stdout does not contain `skipping <name>: has uncommitted or unpushed changes`.
- [x] Merged-mode cleanup removes a merged worktree with unpushed commits (`git log @{u}..` non-empty, upstream present): worktree path gone, local branch deleted, no dirty skip line.
- [x] Merged-mode cleanup removes a dirty merged plan worktree (`.worktree/plan-<name>/`, branch `plan/<name>`, `isMergedPr` true): worktree path gone, local `plan/<name>` branch deleted.
- [x] `jarvis1 cleanup --dry-run` lists a merged-but-dirty worktree under `Worktrees to remove:` (preview includes the branch; no force-remove on disk).
- [x] Not-merged worktree with uncommitted changes: worktree stays on disk, is absent from removal preview, and is not force-removed after declined or completed cleanup.
- [x] `cleanup-command.sandbox-unrunnable.test.ts` scoped merged guard stays green.
- [x] `cleanup-command.sandbox-unrunnable.test.ts` global abandon tests stay green.
- [x] Named triage on dirty merged worktree (`modified`, `mixed`, or `untracked-only` + `MERGED`) suggests `jarvis1 cleanup` for discard (no `stash` prerequisite).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — merged-mode cleanup force-retires merged-but-dirty worktrees; not-merged dirty worktrees silently non-removed; triage rule 4 (`modified`/`mixed`/`untracked-only` + `MERGED`) → `jarvis1 cleanup` without stash; `--abandon` unchanged.
- `v1/docs/operator-runbook.md` — end-of-session cleanup: merged-but-dirty plan worktrees retire via `jarvis1 cleanup`.
- `v1/docs/worktrees-and-commits.md` — triage suggested-moves rule 4: merged + dirty porcelain (`modified`/`mixed`/`untracked-only`) → `jarvis1 cleanup` without stash.
