# 00 - Use worktree-local spec paths

## Problem

`jarvis run` resolves the supplied spec path in the registered project checkout,
then invokes the agent with `cwd` set to `.worktree/<spec>/`. Agents with a
strict filesystem sandbox can edit files under the worktree but cannot update
the original checkout's spec file. That can make completed work look like "no
progress" because Jarvis checks a different spec file than the one the agent can
edit.

## Decisions

- After worktree setup, the worktree is the run's source of truth.
- Keep the originally supplied path for project lookup only.
- Derive the active spec path by mapping the project-relative spec path into the
  agent worktree.
- If the active spec path does not exist in the worktree, seed the original spec
  directory into the worktree without overwriting existing files.
- Use the active spec path for prompt construction, banner task parsing,
  completion checks, no-progress checks, and non-index handling.

## Tasks

- [x] Add a helper that prepares and returns the worktree-local active spec
  path.
- [x] Use the helper immediately after worktree setup and before any spec
  routing or checklist reads.
- [x] Add a focused unit test for seeding a missing spec directory without
  clobbering existing worktree files.
- [x] Document the source-of-truth rule in `README.md`.

## Acceptance criteria

- A strict agent running in `.worktree/<spec>/` receives a spec path under that
  same worktree.
- Jarvis completion and no-progress checks read the worktree-local spec.
- If the spec directory exists only in the original checkout, Jarvis copies it
  into the worktree before building the agent prompt.
- Existing files in the worktree spec directory are not overwritten.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `README.md`: document that after worktree setup, the worktree-local spec is
  the run source of truth.
