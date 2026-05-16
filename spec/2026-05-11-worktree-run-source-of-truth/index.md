# Worktree run source of truth

Jarvis runs agents inside a per-spec worktree. After that worktree exists,
Jarvis should treat the worktree as the only operational checkout for the run.
The originally supplied path is only used to find the registered project and
derive the spec path relative to that project.

## Subspecs

- [x] [00 - Use worktree-local spec paths](./00-use-worktree-local-spec-paths.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-11-worktree-run-source-of-truth/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
