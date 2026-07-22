# 00 - Order retirement local-first and abort on first failure

## Problem

`performAbandonmentSteps` (`v2/src/commands/cleanup.ts`) closes the PR first, then calls
`removeWorktreeAndBranch` with `deleteRemoteBranch: true`, so the remote branch dies last and the PR
dies first. A teardown that dies partway leaves the operator with a closed PR and a live workspace.
Remote branch deletion and PR closure are also best-effort warnings, so a failed remote step still
lets later steps run.

## Decisions

- Retirement order: worktree removal → local branch deletion → remote branch deletion → PR closure. Rules out the current PR-first order.
- PR closure runs last so an open PR remains the operator-visible marker of unfinished retirement. Rules out closing before remote branch deletion.
- Retirement aborts (nonzero, stderr) at the first failing step, leaving later artifacts intact. Rules out best-effort continuation.
- Local branch deletion and remote branch deletion become hard failures on the retirement path only; `performWorktreeRemovals` (bulk cleanup, no remote delete) keeps its best-effort local-branch warning. Rules out flipping strictness for every `removeWorktreeAndBranch` caller.
- Remote branch deletion and PR closure move out of `removeWorktreeAndBranch` into `performAbandonmentSteps`, which sequences them explicitly. Rules out threading more ordering flags through the shared helper.
- No transactional rollback: a deleted remote branch is not restored, a closed PR is not reopened. Rules out undo.
- The `--abandon` preview lines print in the new execution order. Rules out preview/execution divergence.

## Acceptance criteria

- [x] Retirement (`jarvis cleanup --abandon <name>` and the implement-rerun stale-workspace reset) removes the worktree and deletes the local branch before deleting the remote branch or closing the PR.
- [x] A retirement whose worktree removal or local branch deletion fails reports the failure, exits nonzero, and issues no `git push origin --delete` and no `gh pr close`.
- [x] A retirement whose remote branch deletion fails reports the failure, exits nonzero, and issues no `gh pr close`.
- [x] A retirement whose PR closure fails reports the failure and exits nonzero.
- [x] A fully successful retirement still ends with the worktree removed, local branch deleted, remote branch deleted, and PR closed.
- [x] The `--abandon` preview lists the planned actions in execution order (remove worktree, delete local branch, delete remote branch, close PR).
- [x] New tests in `v2/src/commands/cleanup.test.ts` assert the recorded command order and each abort-point (local failure, remote failure, PR-closure failure); they fail against the pre-fix code.
- [x] Inverting each added abort guard (continuing past a failed step instead of returning) makes at least one test fail, and the abort-point tests prove the later commands are absent, not merely unasserted.
- [x] Existing `cleanup.test.ts` bulk-retirement tests stay green (`performWorktreeRemovals` best-effort local-branch behavior unchanged).
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § `--abandon` — new teardown order, where a partial retirement can stop, and that an open PR means retirement did not finish.
- `v2/docs/v1-behaviors.md` — update the `--abandon` and implement-rerun reset entries with the new order and hard-fail semantics.
