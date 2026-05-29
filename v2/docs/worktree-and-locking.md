# Worktree and locking (Phase 1)

Phase 1 `jarvis write` runs materialize worktrees outside target repos:

- Worktree path: `~/.jarvis/worktrees/<project>/<branch>/`
- `<project>` is the target repo directory basename.
- `<branch>` is the target branch name used for the run checkout.

The worktree and its git checkout are the only persisted run state in Phase 1.
No SQLite state, run rows, attempt ledger, or transcript persistence is created.

## `.jarvis.lock` behavior

- Lock file path: `<worktree>/.jarvis.lock`
- Lock payload matches v1 contract (`pid`, `started_at`, `host`).
- Lock acquisition is best-effort excluded from git staging by appending
  `.jarvis.lock` to worktree-local `info/exclude`.
- If a live PID owns the lock, acquisition fails with a busy error.
- Lock is held for the full one-shot write step: worktree acquisition through
  result materialization.
