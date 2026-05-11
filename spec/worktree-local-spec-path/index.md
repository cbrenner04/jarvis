# Worktree-local spec path

Jarvis should hand agents a spec path they can edit from inside the per-spec
worktree. When a spec exists only in the main checkout, Jarvis should seed that
spec into the worktree and then use the worktree-local copy for prompts and
completion checks.

## Subspecs

- [x] [00 - Use worktree-local spec paths](./00-use-worktree-local-spec-paths.md)

## Conventions

- Run this spec with `jarvis run spec/worktree-local-spec-path/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
