# cleanup --abandon retires unmerged worktrees

## Behavior

`jarvis1 cleanup` today removes worktrees whose PR **merged** and archives their
spec. Abandoning a run (red, stuck, or wrong-track) still requires the manual
`gh pr close` + `git worktree remove --force` + `git branch -D` +
`git push origin --delete` sequence.

Add `jarvis1 cleanup --abandon [--dry-run]`: the inverse selector over the same
`.worktree/` scan. For each eligible worktree it closes the open draft PR (if
any), force-removes the worktree, deletes the local and remote branch, and
leaves the source spec untouched so `jarvis1 run` re-runs the same spec cleanly.

Eligible = the branch's PR is **not merged** and is **not** an open non-draft
(ready) PR. Closed PR, absent PR, and open *draft* PR all qualify. A merged PR
(cleanup's domain) or an open ready PR (an active run, not abandoned) is skipped.

`--abandon` and the default merged-cleanup are mutually exclusive modes over the
same worktree set; `--abandon` flips eligibility and the post-removal actions.
"Matching" PR throughout = a PR on the same branch name (per `findMatchingOpenPrs`).

## Decisions

- Surface as a `--abandon` flag on `cleanup`, not a new top-level subcommand — rules out a separate `retire`/`abandon` command; reuses cleanup's scan/preview/confirm/dry-run scaffold and reads as the symmetric inverse of merged-cleanup.
- Eligible = not MERGED and not an open non-draft PR; skip an open ready PR or a branch with multiple open matching PRs — rules out retiring any non-merged worktree blindly, which would nuke an active, ready-for-review run.
- Two-gate eligibility: an explicit `isMergedPr` guard **and** `findMatchingOpenPrs` — rules out checking only "no open PR", which a merged worktree also satisfies, silently retiring (and stranding) a merged run that belongs to default cleanup.
- Retire order: close PR → force-remove worktree → delete local then remote branch — rules out branch-first deletion (loses the PR handle / leaves a dangling worktree entry); close before delete preserves the PR handle, worktree-remove before branch-delete avoids orphaning the worktree's branch ref.
- `closePr` failure is non-fatal (including "already closed"); retire continues — rules out aborting on a PR that raced to closed/absent between scan and retire; symmetric with best-effort remote-branch deletion.
- Force-remove dirty worktrees (`git worktree remove --force`) — rules out cleanup's skip-if-dirty guard; an abandoned red run is dirty by nature.
- Delete the remote branch too, best-effort (absence is non-fatal) — rules out local-only deletion; a lingering closed-PR remote branch blocks a fresh draft PR on re-run.
- Never archive or delete the spec directory — rules out cleanup's archive-to-`completed/` path; the spec must stay put for a clean re-run.
- Reuse existing helpers (`findMatchingOpenPrs`/`isDraft`, `closePr`, force worktree-remove, `deleteLocalBranch`, `deleteRemoteBranch`) rather than re-implementing git/gh calls.
- Deferred to first consumer: dry-run output format — pin when a caller needs it.

## Task checklist

- [ ] Parse `--abandon` on the `cleanup` subcommand (combinable with `--dry-run`).
- [ ] Add abandon selection + retire actions to the cleanup command.
- [ ] Update `cleanup` usage/help text.
- [ ] Tests for eligibility, skips, dry-run, and retire actions.
- [ ] Docs: worktrees-and-commits.md, operator-runbook.md, v2/docs/v1-behaviors.md.

## Acceptance criteria

- [x] `jarvis1 cleanup --abandon` retires a worktree whose PR is closed: force-removes the worktree, deletes the local branch, and deletes the remote branch.
- [x] `jarvis1 cleanup --abandon` retires a worktree with **no** PR (closed/absent treated alike).
- [x] An eligible worktree with an open **draft** PR ends retired with the PR closed and the worktree, local branch, and remote branch removed.
- [x] A worktree whose PR is **merged** is skipped under `--abandon` (left for default cleanup).
- [x] A worktree with an open **non-draft (ready)** PR, or multiple open matching PRs, is skipped (not retired) under `--abandon`.
- [x] A **dirty/contaminated** eligible worktree is still removed under `--abandon` (force), unlike default cleanup which skips dirty worktrees.
- [x] After a retire completes, the source spec directory is still present and unmodified on disk, so a subsequent `jarvis1 run` re-runs it.
- [x] Remote-branch deletion is best-effort: a missing remote branch does not fail the retire.
- [x] A `closePr` failure (including an already-closed/absent PR) is non-fatal: the retire still removes the worktree and branches.
- [x] `jarvis1 cleanup --abandon --dry-run` previews exactly the eligible worktrees, suppresses the confirmation prompt, and makes no changes (no PR close, no worktree/branch removal).
- [x] Declining the confirmation prompt cancels the retire with no side effects (no PR close, no worktree/branch removal).
- [x] `cleanup` help/usage text documents `--abandon`.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — Cleanup section: document the `--abandon` mode (eligibility, force-remove, local+remote branch delete, draft-PR close, spec left intact) alongside merged-cleanup.
- `v1/docs/operator-runbook.md` — replace the manual abandon sequence (`gh pr close` + `git worktree remove --force` + `git branch -D` + `git push origin --delete`) with `jarvis1 cleanup --abandon`.
- `v2/docs/v1-behaviors.md` — update the `cleanup` entry: this changes the existing command's surface and behavior (new `--abandon` mode).
