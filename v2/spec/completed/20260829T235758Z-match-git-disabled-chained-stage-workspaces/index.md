# Match git-disabled chained-stage workspaces

- [x] [00 - Match git-disabled chained-stage workspaces](./00-match-git-disabled-chained-stage-workspaces.md)

Scope: extend `createChainedStageProjectMatch` so chained plan/implement stages resolve git-disabled prior worktrees under `~/.jarvis/intent-work/<project-safe-id>/` and `~/.jarvis/specs/<project-safe-id>/plans/<name>/`. Depends on landed `share-external-workspace-project-safe-id`. External ready-intent CLI admission and fan-out lane semantics stay out of scope.
