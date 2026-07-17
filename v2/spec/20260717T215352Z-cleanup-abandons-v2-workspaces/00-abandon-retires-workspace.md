# Abandon retires a wedged v2 workspace

`jarvis cleanup` today only retires merged workspaces and archives completed specs; an unmerged or wedged v2 run — one the daemon no longer tracks as active after a restart — leaves a worktree and branches the operator must hand-remove. Add `jarvis cleanup --abandon <name>` to preview and retire one named v2 workspace, authorized by filesystem/git/lock/PR state rather than daemon agreement.

On `--abandon <name>`, cleanup resolves the name to its `(project, branch)`, worktree path, and matching PR, previews the planned retirement, and on confirmation: closes the one matching draft PR best-effort, force-removes the worktree, and deletes the local and remote branches. It leaves the source spec files and durable run rows intact. It refuses before touching anything when the worktree is missing or held by a live run.

PR-ownership refusals (ready PR, multiple open PRs) are added in subspec 01; this subspec closes whatever single matching PR it resolves.

## Decisions

- Abandon authorizes on filesystem/git/lock/PR state, not daemon agreement; rules out gating recovery on leaked in-memory daemon state.
- Leave the source spec files and durable run rows intact; rules out treating abandon as completion or history deletion.
- Refuse a missing worktree or one held by a live run — live `.jarvis.lock` holder (`isProcessAlive`) or daemon `isLive`; rules out clobbering an active run's worktree.
- Force-remove the worktree (`git worktree remove --force`); rules out failing on the dirty/wedged working tree abandon exists to clear.
- Close the one matching draft PR best-effort — a `gh pr close` failure warns but still completes worktree/branch retirement; rules out leaving worktree/branch debris when only the PR-close call fails.
- Delete the remote branch too (`git push origin --delete`); rules out leaving the spec un-runnable-clean because a stale remote branch collides with a fresh run's push.
- Refusals exit nonzero and remove nothing. Deferred to first consumer: distinct per-reason exit codes — pin when a caller needs to branch on them.

## Task checklist

- Parse `--abandon <name>` in the cleanup CLI path and route to a scoped-abandon handler.
- Resolve `<name>` → project, branch, worktree path, and matching open PR.
- Refuse (nonzero, nothing removed) a missing worktree or a live-held worktree (lock or daemon `isLive`).
- Preview planned actions; prompt confirmation; decline changes nothing.
- On confirm: best-effort `gh pr close <n>` → `git worktree remove --force <path>` → `git branch -D <branch>` → `git push origin --delete <branch>`; prune.
- Leave spec files and the durable run row in place.

## Acceptance criteria

- [ ] A new test drives `cleanup --abandon <name>` against a real temp-git fixture holding an unmerged workspace and asserts exact argv `git worktree remove --force <path>`, `git branch -D <branch>`, and `git push origin --delete <branch>` are invoked and the worktree and branches are gone afterward; it fails against the pre-fix code.
- [ ] A test asserts the one matching draft PR is closed via `gh pr close <number>` (exact argv) and that a failing `gh pr close` still completes worktree and branch retirement with a warning.
- [ ] A test asserts `cleanup --abandon <name>` refuses a workspace held by a live run (live `.jarvis.lock` holder or daemon `isLive`), removes nothing, and exits nonzero.
- [ ] A test asserts `cleanup --abandon <name>` against a missing worktree removes nothing and exits nonzero.
- [ ] A test asserts the source spec files and the durable run row for the abandoned `(project, branch)` remain present after retirement.
- [ ] A test asserts the preview lists the planned close/remove/delete actions and that declining confirmation changes nothing (no `git worktree remove`, no `gh pr close`, no branch deletion).

## Documentation updates

- `v2/docs/operator-runbook.md` — replace the "hand-removal remains the path for a failed run's leaked worktree" recovery workaround with `jarvis cleanup --abandon <name>`: wedged-run abandonment, what it retires vs. leaves intact, and the missing/live-held refusals.
