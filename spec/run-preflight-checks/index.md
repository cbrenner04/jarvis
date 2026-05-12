# Preflight environment checks for `jarvis run`

repo: git@github.com:cbrenner04/jarvis.git

`jarvis run` already calls `assertGhReady()` early when effective `git`
is `true` (see `src/commands/run.ts`). Two failure modes still produce
misleading errors:

1. When `gh` is missing from `PATH` entirely, the `assertGhReady` spawn
   fails with `Error: spawn gh ENOENT` (Node) / `posix_spawn 'gh'` (Bun).
   `runGhCommand`'s error handler stringifies that into `stderr`, so the
   user sees the raw ENOENT text rather than an actionable "binary not
   found on PATH" message.
2. When `resolveProject` returns a `ProjectMatch` whose `root` exists in
   the config (or was discovered via the ad-hoc git-checkout walk) but no
   longer exists on disk, the failure surfaces several call sites later
   as `failed to create or resume worktree: failed to detect base branch:
   Error: ENOENT ... posix_spawn 'gh'`. That message looks like a `gh`
   problem but is in fact a missing-directory problem: `posix_spawn`
   returns `ENOENT` when the child's `cwd` does not exist, with the
   binary name in the message text.

This spec closes both gaps.

Key decisions, captured so subspecs stay focused:

- `runGhCommand`'s spawn `'error'` handler distinguishes `ENOENT` from
  other spawn errors and substitutes the dedicated message
  `gh: binary not found on PATH. Install with 'brew install gh' or ensure its directory is on PATH for this shell.`
- After `resolveProject` succeeds, `jarvis run` verifies the resolved
  `project.root` is an existing directory before any side-effecting
  work (worktree, gh, agent spawn, session log open).
- Project-root validation runs regardless of effective `git`, since
  loop-only mode also needs a valid `cwd` for the agent.
- A `--cwd` override, when used, is already validated for existence at
  `src/commands/run.ts:128-131`. No change needed there.
- Future preflight for the `git` binary itself is out of scope.

- [x] [00 - Translate ENOENT in gh spawn](./00-translate-enoent-in-gh-spawn.md)
- [ ] [01 - Validate resolved project root exists](./01-validate-project-root.md)
