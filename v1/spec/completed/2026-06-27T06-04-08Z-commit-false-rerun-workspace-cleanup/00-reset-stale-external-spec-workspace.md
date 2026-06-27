# 00 - Reset stale external-spec workspace

External specs authored under `plan.commit:false` can be re-run in git-backed patch mode before the prior implementation completes. Today the source spec auto-resets stale checklist/blocker edits, but the patch worktree, local branch, remote branch, and draft PR can remain and collide with the fresh attempt.

This applies only to external Jarvis-owned specs with unchecked non-human-only acceptance criteria, run with effective `git:true`. It does not apply to ordinary in-repo spec resumes or `git:false` loop-only runs.

## Decisions

- Treat prior patch state as stale only when the external source spec has unchecked non-human-only acceptance criteria and the matching worktree has no live `.jarvis.lock`; rules out deleting a workspace that another run may still be using.
- Close exactly one open draft PR whose head branch is the spec implementation branch in the target repo before deleting git state; rules out closing non-draft PRs, multiple PRs, fork PRs, or PRs for a different branch.
- Ignore already-closed PRs and continue cleanup when no open PR exists; rules out requiring manual cleanup of historical PR records.
- Refuse cleanup when the matching open PR is non-draft or multiple open PRs match; rules out destroying operator-mutated review state.
- Delete both local `<spec-name>` and `origin/<spec-name>` before creating the fresh worktree/branch; rules out reusing or silently pushing over stale remote branch state.
- Fresh worktree/branch means a new local branch from the detected base branch with no surviving local or remote implementation ref; rules out starting from stale commits.
- Cleanup remains limited to external specs authored by `plan.commit:false` and re-run with effective `git:true`; rules out changing ordinary in-repo resumes or `git:false` loop-only reset behavior.
- If any cleanup step cannot be proven successful, abort before agent invocation; rules out running against partially reset workspace state.

## Tasks

- Detect the external `plan.commit:false` + effective `git:true` patch re-run case before patch worktree creation.
- Refuse cleanup when the matching worktree has a live lock.
- Close the single matching stale draft PR when one exists; refuse ambiguous or non-draft open PR state.
- Remove the matching stale worktree, local branch, and remote branch, then create a fresh worktree/branch for the new attempt.
- Preserve existing source-spec delta reset behavior.
- Add coverage for stale PR/worktree/branch cleanup, live-run refusal, PR edge cases, remote branch reset, and cleanup failure.

## Documentation updates

- Update `v1/docs/operator-runbook.md` for external `plan.commit:false` re-run cleanup without conflating `git:false` no-commit reset.
- Update `v1/docs/worktrees-and-commits.md` with the external-spec exception to normal patch worktree/branch reuse.
- Update `v2/docs/v1-behaviors.md` with the updated v1 external `plan.commit:false` patch re-run behavior.

## Acceptance criteria

- [x] Re-running an incomplete external spec authored by `plan.commit:false` with effective `git:true` closes the single stale draft PR for target-repo branch `<spec-name>`, removes stale `.worktree/<spec-name>/`, deletes stale local and remote `<spec-name>` refs, and starts the next agent attempt from a new base-branch worktree/branch.
- [x] The same re-run still resets prior-attempt checklist ticks and appended `## Blocker` text before invoking the agent.
- [x] If the matching worktree has a live `.jarvis.lock`, `jarvis1 run` exits before cleanup and before invoking any agent.
- [x] If the matching open PR is non-draft or multiple open PRs match the branch, `jarvis1 run` exits before deleting worktree or branch state and reports the unsafe PR state.
- [x] Already-closed PRs do not block cleanup, and absence of an open PR still allows stale worktree, local branch, and remote branch cleanup.
- [x] If closing the stale draft PR or removing stale local or remote git state fails, `jarvis1 run` exits before invoking any agent and reports the failed cleanup step.
- [x] Ordinary in-repo spec re-runs keep the existing resume behavior: an existing worktree/branch is reused rather than auto-deleted.
- [x] `git:false` loop-only re-runs keep the existing no-worktree behavior and only reset prior-attempt source-spec checklist/blocker mutations.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.
- [x] `v1/docs/operator-runbook.md` documents external `plan.commit:false` git-backed re-run cleanup separately from `git:false` no-commit reset.
- [x] `v1/docs/worktrees-and-commits.md` documents the external-spec cleanup exception to normal patch worktree/branch reuse.
- [x] `v2/docs/v1-behaviors.md` records the updated v1 behavior for external `plan.commit:false` git-backed spec re-runs.
