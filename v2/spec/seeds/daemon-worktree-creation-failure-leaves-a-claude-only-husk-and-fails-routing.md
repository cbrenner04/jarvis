# Daemon worktree creation can leave a `.claude`-only husk, then fail at routing

## Problem

`jarvis run workflow implement` failed **three times in a row** with:

```
routing_read_failed: Failed to read linked routing index
.../worktrees/jarvis/<branch>/v2/spec/<spec>/index.md: ENOENT
```

The worktree path existed but contained **only** a `.claude/` directory — no `.git`, no checked-out
tree, no spec. `git worktree list` did not name it. Yet a **manual** `git worktree add
<same-path> -b <branch> main` at that exact path **succeeded immediately** and checked out the current
tree (spec present). After pre-creating the worktree by hand, the very next `implement` launch reused
it and ran fine.

So the daemon's own worktree materialization failed, left a `.claude`-only husk (the agent-config
dir is created before/around the failed checkout), and the run proceeded to the routing read instead
of aborting — surfacing a misleading `routing_read_failed: ENOENT index.md` when the real failure was
worktree creation. Observed 2026-07-17, immediately after a daemon restart, on a branch whose sibling
`plan/<name>` worktree was still registered.

Two distinct defects:

1. **Worktree creation failure is swallowed.** The daemon must have hit an error from its
   `git worktree add` (the manual equivalent works, so it is environmental/transient — a lock, a
   stale index, a race with a sibling worktree op), yet it proceeded to invoke the agent and read the
   routing index rather than aborting with the creation error.
2. **The husk poisons retries.** Once the `.claude`-only directory exists at the path, every re-run
   re-hits `routing_read_failed` because the path "exists" — so the run never re-attempts creation.
   Recovery required hand-removing the dir (and, when its `.git/worktrees/` registration was stale,
   pruning) before the daemon would build a real worktree.

## Decisions

- Worktree materialization verifies success (a real `.git` and the expected checked-out tree) before
  the run proceeds; a failed `git worktree add` aborts the run with the creation error, not a
  downstream `routing_read_failed`; rules out invoking the agent against a husk.
- A path that exists but is not a valid worktree for the expected branch is reclaimed and rebuilt (it
  holds no git state and no uncommitted work), rather than treated as an existing worktree to reuse;
  rules out the husk poisoning every retry.
- The error surfaced to the operator names the worktree-creation failure, not the missing index;
  rules out the misleading ENOENT.

## Notes

Sibling to [[non-worktree-directory-at-the-worktree-path-fails-the-run]] (a leftover dir from prior
hand-teardown). Same failure mode — husk at the worktree path → `routing_read_failed` — but a
distinct trigger: there the debris pre-existed; here the **daemon itself** created the husk by
proceeding past its own failed `git worktree add`. Both point at the same fix: verify the worktree is
real before routing, and reclaim a husk rather than fail on it.

The manual-add-then-reuse workaround costs an operator a hand `git worktree add -b <branch> main` at
the expected path before re-launching. Note it also intersects the missing v2 cleanup
([[v2-reclaims-its-workspace]]) — husks accumulate because nothing retires them.
