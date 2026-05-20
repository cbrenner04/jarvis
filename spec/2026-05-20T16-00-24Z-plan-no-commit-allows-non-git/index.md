# `jarvis plan` with `commit: false` should work in non-git directories

repo: cbrenner04/jarvis

`jarvis plan` against a registered project that is not a git checkout currently exits with `commit: false requires a git repository` (`src/commands/plan.ts:1064`). The `commit: false` path was originally scoped to git repos by [spec/completed/2026-05-18T13-39-03Z-plan-mode-config-and-no-commit/02-no-commit-plan-flow.md](../completed/2026-05-18T13-39-03Z-plan-mode-config-and-no-commit/02-no-commit-plan-flow.md), but the rationale there was scope containment, not safety: nothing on the `commit: false` code path actually invokes git, opens a worktree, or talks to `gh`. Spec files are written to `~/.jarvis/specs/<project-safe-id>/<spec-dir>/`, the agent runs against `project.root` directly, and `injectRepoLineIntoIndex` already falls back from `project.origin` to `project.key` when no origin is configured. Removing the guard makes plan mode usable in registered non-git directories without extending the no-commit path's surface area.

- [ ] [00 - Allow `commit: false` plan runs in non-git directories](./00-plan-no-commit-allows-non-git.md)
