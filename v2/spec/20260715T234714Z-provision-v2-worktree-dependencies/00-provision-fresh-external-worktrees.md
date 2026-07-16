# Provision fresh external worktrees

Fresh git-backed v2 worktrees cannot resolve project dependencies because they live outside the project tree. Provision dependency access before the first agent callback so prescribed verification works immediately.

## Decisions

- Link `<projectRoot>/node_modules` at `<worktree>/node_modules` during fresh git-backed external-worktree creation; rules out per-worktree installs and callback-time repair.
- Provision only newly created git-backed worktrees; rules out mutating reused worktrees or `git:false` local paths.
- Keep worktrees under the Jarvis worktree home; rules out relocation beneath the project for Bun directory up-walk.
- Preserve the full ready gate and its repair loop unchanged; rules out weaker completion evidence.

## Work

- Add dependency linking to the shared external-worktree creation boundary before callback execution.
- Add focused regression coverage for link target and callback ordering.

## Documentation updates

- `v2/docs/workflow-runner.md` — document dependency provisioning at external-worktree creation.
- `v2/docs/operator-runbook.md` — remove the obsolete no-dependencies workaround.
- `v2/docs/v1-behaviors.md` — record the changed v2 external-worktree setup behavior.

## Acceptance criteria

- [x] A fresh git-backed external worktree exposes the project root's `node_modules` before its first callback, so Bun commands there resolve the project's installed dependencies without agent setup.
- [x] `v2/src/execution/external-worktree.test.ts` contains a regression test that observes the dependency link from inside the first callback, targets the project root's `node_modules`, and fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the provisioned external-worktree behavior without changing ready-gate authority.
