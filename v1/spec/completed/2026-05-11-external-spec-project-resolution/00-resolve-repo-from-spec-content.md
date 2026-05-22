# Resolve repo from spec content

Specs may live anywhere. Jarvis needs to read the supplied spec first and use
its explicit repo path to choose the working directory.

## Decisions

- Every runnable spec must include a top-level `repo: <absolute-path>` line.
- The repo path is the directory Jarvis uses for worktree creation, git, `gh`,
  and agent cwd.
- Do not infer a repository from the spec location, registered project roots, or
  the operator's shell cwd.

## Tasks

- [x] Resolve specs from `repo: <absolute-path>` before choosing the working
  directory.
- [x] Hard-fail specs without `repo:` or with a non-absolute repo path.
- [x] Add tests for repo-based routing and missing/invalid repo hints.

## Documentation updates

- [x] `README.md`: document the required `repo:` field.
- [x] `docs/run-loop.md`: document spec-first repo resolution.
- [x] `docs/spec-guidance.md`: document the required spec header.

## Verification

Run:

- `bun run typecheck`
- `bun test`
- `bun run lint`

