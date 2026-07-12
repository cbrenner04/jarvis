# v2 has no cleanup

v2 creates worktrees, branches, and durable run state, and never reclaims any of
it. There is no `jarvis cleanup`. Everything accumulates until the operator
reaches for `git worktree remove --force` by hand.

## Problem

Observed 2026-07-12, driving v2 for a session:

- **Leaked worktrees block future work.** Wedged plan runs left five worktrees
  under `~/.jarvis/worktrees/jarvis/plan/<slug>/`. Each held its `plan/<slug>`
  branch, so `jarvis1 plan` on the same intent failed outright:
  `fatal: '<branch>' is already used by worktree at ...`. Recovery was five
  manual `git worktree remove --force` + `git branch -D` pairs.
- **Merged work is never retired.** Worktrees whose PR merged hours ago are still
  on disk, still holding branches.
- **Completed specs are never archived.** v1 moves them to `completed/`; v2 leaves
  them in `<targetDir>` root forever.
- **Consumed ready-intents linger** after their plan lands.

v1's `jarvis1 cleanup` does all of this, but it only knows about
`<repo>/.worktree/` — it cannot see v2's `~/.jarvis/worktrees/<project>/<branch>/`
home, so it is not a workaround.

## Scope

- `jarvis cleanup` — retire merged v2 worktrees and their branches, archive
  completed specs, prune consumed ready-intents.
- `jarvis cleanup --abandon <name>` — retire an unmerged/wedged run: close its
  draft PR best-effort, force-remove the worktree, delete local + remote branch,
  leave the spec in place for re-run.
- Guards, mirroring v1: refuse to archive an incomplete spec; refuse while an open
  PR or another worktree still owns the name; never delete durable run rows.
- `--dry-run` and a `[y/N]` prompt.

## Decisions

- **A wedged run's worktree must be reclaimable without the daemon's cooperation.**
  The runs that leaked worktrees were exactly the ones the daemon had lost track
  of (`run kill` → `run_not_active` while `list` said `in-progress`/`live`). A
  cleanup that only retires runs the daemon agrees are terminal would not have
  helped in the one case that mattered.
- Reuse v1's cleanup semantics and flag surface rather than inventing a second
  vocabulary — same operator, same mental model.
- Durable run rows are not cleanup's business; `list` retention already bounds
  what the operator sees (see `daemon-terminal-run-retention`).

## Prerequisites

- None. v1's `v1/src/modes/cleanup/` is the reference implementation to port.

## Out of scope

- Reaping the *in-memory* wedged run — that is `workflow-wedged-run-killable`.
- Retention of `list` output — that is `daemon-terminal-run-retention`.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — end-of-session cleanup.
- `v1/docs/operator-runbook.md` — the v2 cleanup path, and drop the manual
  `git worktree remove --force` stopgap once this ships.
