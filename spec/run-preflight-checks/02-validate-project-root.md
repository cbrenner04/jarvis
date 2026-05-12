# 02 - Validate resolved project root exists

## Problem

`resolveProjectFromSpec` in `src/commands/run.ts` reads the `repo:` line
from a spec and computes `project.root = resolve(repo)`. It validates that
the value is absolute but does not check that the path exists on disk. A
typo like `repo: /User/chris.brenner/Work/jarvis` (missing the trailing
`s`) sails through, and the failure surfaces several call sites later as:

```
failed to create or resume worktree: failed to detect base branch: Error: ENOENT: no such file or directory, posix_spawn 'gh'
```

That message is misleading: `posix_spawn` returns `ENOENT` when the child
process's `cwd` does not exist, not when the binary is missing. The user
spends time investigating `gh`/`PATH` for what is in fact a typo in the
spec's `repo:` line.

After `spec/portable-repo-resolution/` ships, the `repo:` field will
typically be a URL or slug rather than a local path, so this exact typo
fades. But the same failure mode reappears whenever the resolved root —
from the URL match, the registered project record, or `--repo` — points
at a directory that has been moved or deleted.

## Decisions

- Add an existence check in `resolveProjectFromSpec` (or the equivalent
  post-resolution point introduced by `portable-repo-resolution/01`).
  After computing the candidate `root`, verify that it is a directory.
- On failure, return an error message that names the offending path and
  identifies its source (spec `repo:` line, registered project record,
  `--repo` flag), e.g.:
  `resolved project root does not exist: /User/chris.brenner/Work/jarvis (from spec repo: line)`
- The check runs before `assertGhReady` and before any worktree work, so
  no side effects can fire on a bogus path.
- The same existence check applies when effective `git` is `false`: a
  loop-only run still needs a valid `cwd` for the agent.

## Task Checklist

- [ ] Add a directory-existence check after project-root resolution in
  `src/commands/run.ts`.
- [ ] Distinguish the resolution source in the error message (spec /
  registered project / `--repo`).
- [ ] Tests in `src/commands/run.test.ts` (or equivalent) covering each
  resolution source producing the appropriately-attributed error when
  the resolved path does not exist.
- [ ] Test that the check runs before `assertGhReady` and before any
  worktree helper.

## Acceptance criteria

- [ ] A spec `repo:` line pointing at a non-existent path causes
  `jarvis run` to exit non-zero with a message naming the path and
  identifying the spec `repo:` line as the source.
- [ ] A registered project whose `root` no longer exists causes
  `jarvis run` to exit non-zero with a message naming the path and the
  registered project as the source.
- [ ] `--repo` pointing at a non-existent path causes `jarvis run` to
  exit non-zero with a message naming the path and the flag as the
  source.
- [ ] In all three cases, no `.worktree/` directory is created, no
  `git` or `gh` subprocess is invoked, no agent is spawned, and no
  session log file is opened.
- [ ] The check fires regardless of effective `git` value.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- `docs/run-loop.md` "Preflight checks" subsection (added in subspec 01):
  list the project-root existence check alongside the `gh` auth check.
- `docs/spec-guidance.md`: brief note that a `repo:` value pointing at a
  missing directory produces a named error rather than the historical
  worktree-flavored one.
