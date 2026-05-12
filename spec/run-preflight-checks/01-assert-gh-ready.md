# 01 - Assert gh ready at run startup

## Problem

`src/commands/run.ts` does not invoke `assertGhReady()` before worktree
setup, so the first time `gh` is exercised on the run path is inside
`getBaseBranch()` at `src/worktree.ts`. When `gh` is missing or
unauthenticated, the failure is wrapped as
`failed to create or resume worktree: failed to detect base branch: ...`
and side effects (worktree directory, session log) may already have been
attempted.

This subspec wires the existing `assertGhReady()` helper into the run
flow as an explicit preflight step, gated on effective `git: true` so
loop-only runs are unaffected.

## Decisions

- Call `assertGhReady()` in `src/commands/run.ts` after spec parse, repo
  resolution, and effective-`git` computation, and before worktree
  resolution and any other side-effecting work.
- The call is skipped when effective `git` is `false`. Loop-only mode
  must remain runnable on machines that have no `gh` installed.
- On `assertGhReady` rejection, exit non-zero with the thrown error's
  message. Match the existing CLI error-output pattern in `run.ts` (same
  logging helper, same exit code as other early preflight failures).
- Preflight aborts before:
  - creating or opening `.worktree/<spec-name>/`
  - invoking any `git` command
  - spawning an agent
  - opening a session log file
- No new auth logic; this subspec is plumbing.

## Task Checklist

- [ ] Insert an `assertGhReady()` call in `src/commands/run.ts` at the
  documented ordering point, behind the effective-`git` check.
- [ ] Ensure the rejection path exits with the existing CLI error
  pattern (helper / exit code).
- [ ] Tests in `src/commands/run.test.ts` (or equivalent) covering:
  - With effective `git: true`, a mocked `assertGhReady` rejection
    causes `run` to fail before any worktree helper, `git` shell-out,
    agent spawn, or session log open.
  - With effective `git: false`, `assertGhReady` is not invoked, even
    when the mock would reject.
  - With `assertGhReady` resolving, the run proceeds to worktree
    resolution as before (happy-path regression guard).
- [ ] If subspec 00's wording lands first, verify the `ENOENT` end-to-end
  case produces the new `gh: binary not found on PATH` message in
  `run`'s stderr.

## Acceptance criteria

- [ ] With effective `git: true` and `gh` missing from `PATH`,
  `jarvis run` exits non-zero with a message containing
  `gh: binary not found on PATH` (assuming subspec 00 has shipped),
  creates no `.worktree/<spec-name>/`, invokes no `git` commands, and
  spawns no agent.
- [ ] With effective `git: true` and `gh` present but unauthenticated,
  `jarvis run` exits non-zero with the `assertGhReady` / upstream
  `gh auth status` wording, creates no `.worktree/<spec-name>/`, and
  spawns no agent.
- [ ] With effective `git: false`, `jarvis run` does not invoke
  `assertGhReady` and runs the agent loop even when `gh` is absent.
- [ ] With `gh` installed and authenticated, `jarvis run` proceeds to
  worktree setup; happy-path behavior is unchanged.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- `docs/run-loop.md`: add a "Preflight checks" subsection near the top
  of the run flow. Describe the `gh` auth check, note that it runs
  only when effective `git` is `true`, and note that it runs before
  worktree setup.
- `docs/agents.md`: add a short note that `jarvis run` performs a
  `gh auth status` preflight when `git` is `true`, and that a missing
  `gh` binary now produces a named error rather than a worktree-flavored
  one.
- `README.md`: no change required; `gh` is already listed as a
  prerequisite.
