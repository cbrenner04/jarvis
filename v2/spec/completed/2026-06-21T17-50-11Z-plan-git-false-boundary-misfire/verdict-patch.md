- Git-disabled review must not invoke Git for reviewer edit detection or cleanup. The full review phase must remain external-spec-only, including reviewer roles. This satisfies the spec’s no-stray-Git requirement and avoids `git status`/checkout/clean on a `git: false` worktree.

- Fresh `git: false` planning must determine name collisions solely from the external spec root. It must not probe project worktrees, branches, or remote branches, so a fully local run neither contacts Git remotes nor changes its external spec name based on unrelated Git state.

- Tests must exercise `gitEnabled: false` explicitly and prove the Git-disabled paths: no target-repo boundary failure and no review Git invocation/cleanup, while external-spec boundary enforcement remains active. The current review test leaves the flag unset and therefore does not validate the required behavior.
