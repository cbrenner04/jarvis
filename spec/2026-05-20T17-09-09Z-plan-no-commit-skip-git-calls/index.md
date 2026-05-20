# Skip remaining git calls in `commit: false` plan runs against non-git roots

`jarvis plan` against a registered non-git project with `modes.plan.commit: false` crashes after the draft phase at `src/commands/plan.ts:1670` (`getCurrentBranch(project.root)`) and prints leaked `fatal: not a git repository` lines from `assertTargetRepoPlanBoundary` calls in `src/modes/plan/boundary.ts`. The completed [`2026-05-20T16-00-24Z-plan-no-commit-allows-non-git`](../completed/2026-05-20T16-00-24Z-plan-no-commit-allows-non-git/index.md) spec removed the early-return guard so plan mode enters the main flow for non-git registered projects, but it did not gate the remaining git calls. This spec finishes that work.

- [ ] [00 — Skip remaining git calls on non-git target in `commit: false` plan runs](./00-skip-git-calls-on-non-git-root.md)
