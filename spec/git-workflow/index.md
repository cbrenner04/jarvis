# Git Workflow

Wire Jarvis runs to a git + GitHub flow where a spec equals a PR and each
subspec equals a commit. `gh` is the only supported GitHub client. Each spec
runs inside a dedicated worktree under `.worktree/<spec-name>/`.

## Mapping

- spec directory → branch + PR (branch name = spec directory name)
- subspec file → single commit (subject = subspec H1)
- index.md completion → flip PR from draft to ready for review

## Rules

- `gh` is the default and only client. Do not fall back to raw `git push` to
  origin for PR-bearing operations or to other tooling.
- Never bypass hooks (`--no-verify`, `--no-gpg-sign`, etc.). A failing hook is
  a blocker.
- If a subspec is blocked, append a `## Blocker` section to that file, commit
  the partial state, push, and stop — matching the rule in `AGENTS.md`.
- Runs are resumable. Re-running against the same spec must reuse the existing
  branch, PR, and worktree.

## Subspecs

- [x] [00 - Worktree directory scaffold](./00-worktree-directory-scaffold.md)
- [x] [01 - gh preflight and base branch detection](./01-gh-preflight-and-base-branch.md)
- [x] [02 - Worktree create and resume](./02-worktree-create-and-resume.md)
- [ ] [03 - Dotfile symlinks into worktree](./03-dotfile-symlinks.md)
- [ ] [04 - Subspec commit format](./04-subspec-commit-format.md)
- [ ] [05 - First commit opens draft PR](./05-first-commit-opens-draft-pr.md)
- [ ] [06 - Push per commit](./06-push-per-commit.md)
- [ ] [07 - Pre-commit hook and blocker handling](./07-hook-and-blocker-handling.md)
- [ ] [08 - Flip to ready for review](./08-ready-for-review.md)
- [ ] [09 - jarvis cleanup command](./09-jarvis-cleanup-command.md)
