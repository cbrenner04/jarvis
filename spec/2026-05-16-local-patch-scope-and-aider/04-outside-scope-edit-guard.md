# 04 - Outside-scope edit guard

Once patch scope is parsed and passed to agents, Jarvis should detect edits
outside `Editable`. This guard should be conservative and start as a clear
post-run failure rather than trying to automatically revert files.

## Decisions

- Guard only when `PatchScope.editable` is non-empty.
- Compare changed repo-relative paths after an agent run against the editable
  path list.
- Treat an editable directory entry as allowing changes under that directory.
  Directory entries must end with `/` in the spec to avoid ambiguity.
- Do not revert outside-scope edits automatically. Jarvis must never discard
  user or agent changes behind the user's back.
- If outside-scope edits are found, stop the run with a clear error that lists
  the paths and tells the operator to update the active subspec scope or
  inspect the changes manually.
- The guard should run after every agent result that could have modified the
  worktree, including non-zero exits.
- Keep `index.md` handling separate. Jarvis-owned index checkbox flips must
  not be subject to the active subspec's editable list.

## Patch scope

### Editable

- src/modes/patch/run.ts
- src/repo.ts
- test/run.test.ts
- test/modes/patch/spec.test.ts

### Read-only context

- src/modes/patch/completion.ts
- src/modes/patch/blocker.ts
- src/modes/patch/pr.ts
- docs/worktrees-and-commits.md

### Out of scope

- Do not auto-revert files.
- Do not make `## Patch scope` mandatory.

## Task checklist

- Add a helper that reads changed files from git in the active worktree.
- Add scope matching for exact files and explicit directory prefixes ending
  in `/`.
- Wire the guard into the patch run after agent execution and before Jarvis
  stages/commits progress.
- Ensure Jarvis-owned spec/index updates remain allowed.
- Add tests for no scope, exact file matches, directory matches, outside-scope
  files, and changed index files.
- Choose and document the exit behavior. Prefer an existing non-success exit
  category if one fits; otherwise add a narrowly named one.

## Acceptance criteria

- [ ] Runs without editable scope keep current behavior.
- [ ] Runs with editable scope fail clearly when the agent changes files
      outside that scope.
- [ ] Directory scope entries ending in `/` allow nested file changes.
- [ ] Jarvis does not revert, delete, or overwrite outside-scope edits.
- [ ] Jarvis-owned index checkbox updates are not blocked by the guard.
- [ ] Tests cover in-scope and outside-scope changed files.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- Update `docs/run-loop.md` or `docs/worktrees-and-commits.md` to describe
  the outside-scope guard and the manual recovery path.
