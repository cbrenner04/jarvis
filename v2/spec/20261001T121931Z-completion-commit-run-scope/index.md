# Harness commits refuse main-sync content

Lane worktrees that diff against moving `baseRef` treat post-fork `main` edits as lane work; completion `git add -A` then commits blobs matching `main` tip. Refuse those paths at commit time, diff shrink prompts against the lane merge base, and surface reverted paths on `iteration_commit`.

- [x] [00-main-sync-scope-module.md](./00-main-sync-scope-module.md)
- [x] [01-completion-commit-main-sync-refusal.md](./01-completion-commit-main-sync-refusal.md)
- [x] [02-shrink-prompt-merge-base-diffs.md](./02-shrink-prompt-merge-base-diffs.md)
- [ ] [03-iteration-commit-main-sync-telemetry.md](./03-iteration-commit-main-sync-telemetry.md)
