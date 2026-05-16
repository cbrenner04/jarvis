# Multirepo / non-repo working directory

Jarvis resolves the target project from the **spec path** (`findProjectMatchForPath`), not from the shell cwd. GitHub CLI calls that infer the repository must use that same project root as their working directory.

## Decisions

- `gh repo view` for default branch detection runs with `cwd` set to the registered project root.

## Tasks

- [x] Pass project root into base-branch detection so `jarvis run` works when the operator’s shell cwd is outside the git repo (e.g. a parent folder holding several repos).

## Documentation updates

- [x] `README.md` (`jarvis run` section): optional parent-directory workflow.
- [x] `docs/run-loop.md` (iteration): clarify that default-branch lookups use the project root worktree cwd, not the shell cwd.

## Verification

- [x] Unit test: mocked `spawn` confirms `gh` receives `cwd` equal to the repo root passed to `getBaseBranch`.

Run: `bun test test/gh.test.ts`
