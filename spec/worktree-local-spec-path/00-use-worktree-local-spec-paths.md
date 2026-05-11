# 00 - Use worktree-local spec paths

## Problem

`jarvis run` currently resolves the supplied spec path in the main checkout,
then invokes the agent with `cwd` set to `.worktree/<spec>/`. Agents with a
strict filesystem sandbox can edit files under the worktree but cannot update
the main-checkout spec path, so a completed subspec can look like "no
progress" to Jarvis.

## Decisions

- After the worktree is ready, compute the spec path relative to the registered
  project root and map it into the agent worktree.
- If the mapped spec path does not exist in the worktree, copy the source spec
  directory into the worktree without overwriting files already present there.
- Use the worktree-local spec path for prompt construction, migration prompts,
  task selection, and completion/no-progress checks.
- Keep user-facing project lookup based on the originally supplied path.

## Tasks

- [ ] Add a helper that prepares and returns the agent-visible spec path.
- [ ] Use the helper before index/non-index routing and all later spec reads.
- [ ] Cover the missing-worktree-spec case with a focused unit test.

## Acceptance criteria

- A strict agent running in `.worktree/<spec>/` receives a spec path under that
  same worktree.
- If the spec directory exists only in the main checkout, it is copied into the
  worktree before the agent prompt is built.
- Existing files in the worktree spec directory are not overwritten.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- None; this is an internal correctness fix.
