# Preflight environment checks for `jarvis run`

repo: git@github.com:cbrenner04/jarvis.git

When `gh` is missing from `PATH` (or unauthenticated) for the process that
runs `jarvis run`, the failure currently surfaces deep inside worktree setup
as:

```
failed to create or resume worktree: failed to detect base branch: Error: ENOENT: no such file or directory, posix_spawn 'gh'
```

That message buries the real cause — missing binary or unauthenticated `gh`
— under unrelated language about worktrees and base branches. The first
place `gh` is invoked on the run path is `getBaseBranch()` inside
`src/worktree.ts`. `src/gh.ts` already exports an `assertGhReady()` helper
that runs `gh auth status` and throws a clear error, but `src/commands/run.ts`
never calls it.

This spec adds early, user-facing preflight checks that fire after repo
resolution and effective-`git` computation, but before any worktree, git, or
agent-spawn work. It also tightens the spawn-error handling in `src/gh.ts`
so any future code path that hits a missing `gh` binary produces an
actionable error. A related failure — `resolveProjectFromSpec` returning a
project root that does not exist on disk — produces the same misleading
`posix_spawn 'gh'` symptom because `posix_spawn` returns `ENOENT` for a
non-existent child `cwd`. This spec covers that case too.

Key decisions, captured so subspecs stay focused:

- Preflight runs only when effective `git` is `true`. Loop-only mode
  (`git: false`) never invokes `gh`, so requiring it would defeat the
  mode's purpose.
- The auth/install check reuses the existing `assertGhReady()` in
  `src/gh.ts`. No new auth logic.
- `runGhCommand`'s spawn `'error'` handler distinguishes `ENOENT` from
  other spawn errors and substitutes the dedicated message
  `gh: binary not found on PATH. Install with 'brew install gh' or ensure its directory is on PATH for this shell.`
- Preflight failures abort before any side effects: no `.worktree/`
  directory, no `git` invocations, no agent spawned, no session log file
  opened.
- Preflight ordering inside `jarvis run`:
  1. Config load and validation.
  2. Spec parse and repo resolution.
  3. Effective `git` computation.
  4. If effective `git` is `true`: `assertGhReady()`.
  5. Worktree setup (existing behavior).
- A future preflight for the `git` binary itself is out of scope.

## Prerequisites

This spec assumes `spec/portable-repo-resolution/` has shipped and the
effective-`git` toggle (top-level `git: boolean` with optional per-project
override) is in place. Without it, the conditional preflight described here
has nothing to branch on.

- [ ] [00 - Translate ENOENT in gh spawn](./00-translate-enoent-in-gh-spawn.md)
- [ ] [01 - Assert gh ready at run startup](./01-assert-gh-ready.md)
- [ ] [02 - Validate resolved project root exists](./02-validate-project-root.md)
