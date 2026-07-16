---
name: v2-reclaims-its-workspace
---

# v2 never reclaims a workspace, so worktrees accumulate until agents die

v2 creates worktrees, branches, and durable run state and reclaims none of it. There is no
`jarvis cleanup`. Everything accumulates until the operator reaches for
`git worktree remove --force` by hand — and past ~200 registered worktrees, **every** agent
session dies on `E2BIG` before it can run a single command.

Consolidates seeds `v2-cleanup-command`, `v2-rerun-reuses-stale-branch-instead-of-reimplementing`,
`worktree-accumulation-breaks-agent-sandboxes`, and ready-intent
`already-complete-spec-exits-non-zero`. They are one problem — nothing owns reclaiming a v2
workspace — and each was a separate view of its cost.

## Problem

**Nothing is retired.** Observed 2026-07-12: wedged plan runs left five worktrees under
`~/.jarvis/worktrees/jarvis/plan/<slug>/`, each holding its branch, so `jarvis1 plan` on the same
intent failed with `fatal: '<branch>' is already used by worktree at …`. Merged worktrees stay on
disk. Completed specs are never archived (v1 moves them to `completed/`). Consumed ready-intents
linger. v1's `jarvis1 cleanup` only knows `<repo>/.worktree/`, so it cannot see v2's home and is
not a workaround.

**Accumulation is fatal, silent, and total.** Each registered worktree becomes a sandbox
deny-path. Observed 2026-07-13 at 67 registered worktrees (~226 deny paths): two consecutive
claude patch runs blocked with every Bash invocation — including a bare `true` — failing `E2BIG`.
Both agents had *finished the implementation* and could not run `bun run typecheck`, so they left
criteria unchecked and blocked, correctly, for a reason entirely outside the spec.
`dangerouslyDisableSandbox` was also rejected: no escape hatch. There is no degradation — commands
work, then no command works at all — and it hits the *verification* step, so work is done and then
thrown away unverified.

**A re-run reuses stale work instead of redoing it.** Re-running `implement` on a spec whose branch
still exists on `origin` checks out the old branch, sees criteria already ticked, reports
`complete`, and pushes nothing (observed 2026-07-16: `#1609` re-ran to the identical hollow
`c6f11d38`, `#1618` to `a379fd20`). Forcing a genuine re-implementation needs a hand
`git push origin --delete <branch>`. v1 patch mode has this reset; v2 does not.

**An already-complete spec is a silent no-op.** Requesting `implement` on a genuinely complete spec
neither starts work nor says why.

## Scope

- `jarvis cleanup` — retire merged v2 worktrees and their branches, archive completed specs, prune
  consumed ready-intents. `--abandon <name>` retires an unmerged/wedged run (close draft PR
  best-effort, force-remove worktree, delete local + remote branch, leave the spec for re-run).
  `--dry-run` and a `[y/N]` prompt. Guards mirror v1: refuse to archive an incomplete spec; refuse
  while an open PR or another worktree owns the name; never delete durable run rows.
- Re-running an incomplete spec resets its branch to base rather than reusing ticked prior work.
- `implement` on a complete spec reports it and exits non-zero, reading completeness from the spec
  file.
- Bound the worktree count the harness leaves registered, and warn well before the exec-arg cliff.

## Decisions

- **A wedged run's worktree must be reclaimable without the daemon's cooperation.** The runs that
  leaked worktrees were exactly the ones the daemon had lost track of (`run kill` →
  `run_not_active` while `list` said `in-progress`/`live`). Cleanup that only retires runs the
  daemon agrees are terminal would not have helped in the one case that mattered.
- Reuse v1's cleanup semantics and flag surface rather than inventing a second vocabulary — same
  operator, same mental model. `v1/src/modes/cleanup/` is the reference implementation to port.
- **The deny-path list scaling with *historical* worktrees is the bug.** An agent working in one
  worktree does not need 200 deny entries for worktrees that no longer matter. A run about to spawn
  an agent into a sandbox that cannot exec anything says so, rather than letting the agent discover
  it.
- Auto-prune must not remove a worktree another live run owns — a concurrent operator's worktrees
  are never in scope.
- A re-run **resets the branch to base or refuses and says so**; it never silently reuses ticked
  prior work. Reset closes/reopens the matching PR cleanly, so the next publish does not strand on
  `gh pr ready` against a closed PR.
- Completeness is read from the **spec file** (zero unticked acceptance criteria), never from a run
  row's status — a `completed` row on a spec with unticked criteria must not suppress work. Exit is
  non-zero so "already done" is distinguishable from "started" by exit code alone.
- Durable run rows are not cleanup's business; `list` retention already bounds what the operator
  sees (`daemon-terminal-run-retention`).

## Prerequisites

- None.

## Out of scope

- Reaping the *in-memory* wedged run — `workflow-wedged-run-killable`.
- Retention of `list` output — `daemon-terminal-run-retention`.
- Repairing run rows that wrongly claim `completed`.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — end-of-session cleanup.
- `v2/docs/operator-runbook.md` — the cleanup path and how to cleanly re-run a spec; drop the
  manual `git worktree remove --force` stopgap, the "no v2 cleanup" gotcha, and the
  re-request-is-a-no-op bullet.
- `v1/docs/operator-runbook.md` — drop the mid-session-cleanup-or-agents-die caveat and the
  `E2BIG`-is-a-worktree-count-problem note.
