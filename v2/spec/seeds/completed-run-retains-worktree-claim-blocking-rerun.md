# Seed: a completed run retains its worktree claim and blocks re-run

## Problem

After a workflow implement run reaches `completed` / not-live, the daemon keeps the run's in-memory
worktree claim (WorktreeOwnershipRegistry, keyed to `(project, branch)`). A fresh
`jarvis run workflow implement --base main` for the same spec then refuses the stale-workspace reset
with `Cannot re-run incomplete spec: process <daemon-pid> holds worktree lock` — even though the run
is terminal and no `.jarvis.lock` file exists (the "lock" is purely the daemon's retained claim).

Observed 2026-07-18: re-running `daemon-status-reports-source-snapshot` after its first attempt
completed refused this way. The only clean clear is a daemon restart, which was itself blocked by a
concurrent operator's orphaned non-terminal rows (`daemon stop` refused; kill unavailable in-sandbox).
Manual `git worktree remove` then triggered the non-worktree-directory failure
([[non-worktree-directory-at-the-worktree-path-fails-the-run]]) and the reset's own
`git worktree remove` failed (`is not a working tree` → `abandonment failed`). Net: a completed run
can strand its own branch's re-run with no non-destructive recovery when the daemon can't be bounced.

## Decisions

- Release the worktree ownership claim when a run reaches any terminal status (`completed`, `failed`,
  `killed`), so a subsequent re-run's stale-workspace reset is not blocked by a dead run's claim.
- The stale-workspace reset must treat a claim whose owning run is terminal as releasable, not as a
  live lock.

## Acceptance criteria

- [ ] After a workflow implement run reaches a terminal status, a fresh `implement` re-run for the same
      `(project, branch)` performs the stale-workspace reset (or first-run materialize) without a
      `holds worktree lock` refusal, no daemon restart required.
- [ ] A genuinely live run's claim still blocks re-run (the guard only releases on terminal status).
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove the manual worktree-clear recovery for this case once the
  claim releases on terminal status.
