# 00 - CLI entry and worktree safety gates

## Problem

`jarvis review` needs a narrow, predictable entrypoint before any GitHub or
agent behavior is added. Without a clear worktree-resolution boundary and
preflight checks, the command will drift from `jarvis run` on project
resolution, GitHub readiness, and dirty-worktree handling.

## Decisions

- Add a new command surface in `src/cli.ts` and `src/commands/review.ts`:
  `jarvis review <worktree-name>`.
- Reuse shared project resolution and log-server preflight through
  `runSharedPreflight` so `--repo` / `--cwd` behavior, config loading, and
  error messaging stay aligned with patch mode.
- Support only patch worktrees under `<projectRoot>/.worktree/<worktree-name>`.
  Reject missing worktrees and plan worktrees with explicit usage errors rather
  than guessing from the current working directory.
- Run `assertGhReady` before attempting PR lookup so missing `gh` binaries or
  auth failures surface through the existing GitHub preflight path.
- Require the target worktree to start clean:
  - `git status --porcelain` must be empty.
  - The command may reuse existing helpers or extract a shared
    `isWorktreeClean`-style helper, but it must not duplicate subtly different
    dirty-state rules in multiple places.
- Resolve branch identity from git inside the target worktree
  (`git rev-parse --abbrev-ref HEAD`). `.active-spec-path` may be read later
  for prompt context if desired, but it is not the source of truth for branch
  selection.

## Task Checklist

- [ ] Add `review` parsing and help text in `src/cli.ts`.
- [ ] Introduce `src/commands/review.ts` with a command entrypoint that accepts
  the resolved project root, IO, config, and worktree name.
- [ ] Route `jarvis review` through `runSharedPreflight` and `assertGhReady`.
- [ ] Resolve `<projectRoot>/.worktree/<worktree-name>` and reject unsupported
  targets such as missing directories or `plan-*` worktrees.
- [ ] Add the clean-start gate before any PR comment retrieval or agent spawn.
- [ ] Add focused tests for CLI parsing, unknown worktree handling, plan
  worktree rejection, GitHub preflight propagation, and dirty-start refusal.

## Acceptance criteria

- [ ] `jarvis review <worktree-name>` is listed in CLI help and dispatches to a
  dedicated command implementation.
- [ ] The command reuses the same project/log-server resolution path as
  `jarvis run`; project resolution failures surface with the existing messages.
- [ ] A missing worktree exits non-zero with a clear error naming the requested
  `<worktree-name>`.
- [ ] A `plan-*` worktree exits non-zero with a message that review mode only
  supports patch worktrees in v1.
- [ ] If the target worktree has pre-existing local changes, the command exits
  non-zero before contacting GitHub or spawning an agent.
- [ ] `gh` readiness failures surface through the existing `assertGhReady`
  behavior rather than custom shell errors.
- [ ] `bun run typecheck` and `bun test` pass after this slice lands.

## Documentation updates

- `README.md`: add `jarvis review <worktree-name>` to the command list with a
  one-line description.
- `docs/worktrees-and-commits.md`: note that review mode operates on existing
  patch worktrees and requires them to start clean.
