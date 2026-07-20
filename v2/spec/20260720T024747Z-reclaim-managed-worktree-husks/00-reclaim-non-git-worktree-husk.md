# Reclaim a non-Git worktree husk

A failed materialization can leave an ordinary directory at the managed external-worktree path. A retry currently refuses that path, forcing manual removal even though the branch lock already serializes validation and replacement.

## Decisions

- Reclaim only when the exact managed path is absent from the target repository's registered worktrees and Git does not recognize the path as a worktree; rules out deleting registered residual state or a valid checkout owned by another repository or branch.
- Remove the husk and continue branch discovery and worktree creation under the same acquired branch lock; rules out returning it as reused or requiring another retry.
- Keep ambiguous Git ownership or validation failures fail-closed; rules out treating an inconclusive probe as permission to delete.

## Implementation

- Classify an existing invalid managed path against Git registration and repository state, then remove only a proven unregistered non-Git directory.
- Continue the existing prune, branch selection, worktree creation, dependency provisioning, and callback path in the same materialization attempt.
- Add focused external-worktree regression and refusal coverage.
- Document retry recovery in `v2/docs/operator-runbook.md` and record the behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/execution/external-worktree.test.ts` includes a regression test that leaves an unregistered non-Git directory at the managed path, then proves one retry removes it, materializes the expected branch there, and reaches the callback without manual prune/removal; the test fails against the pre-fix code.
- [ ] Existing paths with Git worktree state, including a worktree for another repository or branch, are refused and left intact; ambiguous ownership or validation failures also leave the path intact.
- [ ] Reclamation and replacement complete within one branch-lock acquisition, and the lock is released on success or failure.
- [ ] `v2/docs/operator-runbook.md` describes automatic husk recovery and the fail-closed cases that still require operator diagnosis.
- [ ] `v2/docs/v1-behaviors.md` records the v2 external-worktree retry behavior and source paths.
