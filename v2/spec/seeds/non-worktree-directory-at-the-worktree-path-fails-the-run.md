# A leftover directory at the worktree path fails the run instead of reclaiming it

## Problem

`jarvis run workflow implement` died in ~1s with:

```
routing_read_failed: Failed to read linked routing index
/Users/…/.jarvis/worktrees/jarvis/<branch>/v2/spec/<spec>/index.md: ENOENT
```

The path existed — but as **debris**, not a worktree. It held a single `.claude/` directory and no
`.git`; `git worktree list` did not name it. It was residue from a prior session's hand-teardown
(`git worktree remove` cleaned the git state, the directory survived).

Observed 2026-07-16. Three of the four directories under `~/.jarvis/worktrees/jarvis/` were in this
state; hand-teardown is the norm today precisely because `v2-reclaims-its-workspace` has not shipped,
so this is a recurring condition, not a one-off.

The run treats *directory exists* as *worktree exists*, skips materialization, and then fails at the
first read inside it. The error names the missing index — which is true but misleading. The index is
missing because the worktree was never created, and the worktree was never created because a husk
occupied its path. An operator reading `routing_read_failed` goes looking for a bad `--spec`.

## Decisions

- Materialization must verify the path is a live worktree for the expected branch, not merely
  present; rules out `existsSync` as the reuse test.
- A path that is not a registered worktree is reclaimed and materialized fresh when it holds no git
  state and no uncommitted work; rules out failing the run over debris the harness itself left.
- A path holding real git state that does not match the expected branch fails with a named error
  identifying the occupant; rules out silently deleting a worktree that might be someone's work.
- The failure names the worktree state, not the downstream read; rules out reporting
  `routing_read_failed` for a worktree that was never materialized.

## Notes

Overlaps `v2-reclaims-its-workspace` (the cleanup anchor) at the edges but is distinct: cleanup
retires *merged* workspaces on operator command; this is the run path tolerating debris at
materialization time. Cleanup shipping reduces the frequency; it does not close this.

Related: `v2-rerun-reuses-stale-branch-instead-of-reimplementing` — same family (reuse decisions made
on insufficient evidence), different trigger.
