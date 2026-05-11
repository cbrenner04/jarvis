# 02 - Worktree create and resume

## Problem

Each spec needs its own worktree. Re-running the same spec must reuse existing
state instead of erroring or clobbering work.

## Decisions

- Worktree path is `.worktree/<spec-dir-name>/`. Branch name equals the spec
  directory name.
- Branch is created from the base branch resolved in subspec 01 only when the
  branch does not yet exist locally or on origin.
- `jarvis run` from the main checkout auto-`cd`s into the worktree before
  invoking the agent.
- Resume semantics:
  - worktree present + branch present → reuse both
  - worktree missing + branch present (local or remote) → recreate worktree
    checked out to the existing branch
  - neither present → create branch off base, create worktree
  - PR already open for the branch → reuse it (no new PR)

## Tasks

- [ ] Implement `ensureWorktree(specName)` returning the absolute worktree
  path.
- [ ] Use `git worktree add` for new worktrees and `git worktree add
  --checkout` against an existing branch for the missing-worktree case.
- [ ] Fetch from origin before branch-existence checks so remote-only branches
  are seen.
- [ ] Make `jarvis run <spec>` chdir into the worktree after `ensureWorktree`.

## Acceptance criteria

- First run on a new spec creates `.worktree/<spec>/` and a fresh branch off
  the detected base.
- Deleting `.worktree/<spec>/` and re-running recreates the worktree on the
  same branch without losing remote commits.
- Re-running mid-spec continues against the same branch and (eventually) the
  same PR.

## Docs

- Document the resume guarantees in the README's git-workflow section.
