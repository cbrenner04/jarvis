---
name: patch-self-commit-aborts-run-nothing-to-commit
---

# patch agent self-committing aborts the run on the empty per-subspec completion commit

## Problem

When the patch agent commits its own changes during a subspec, jarvis's
per-subspec **completion commit** later finds a clean tree and `git commit -F -`
fails with `nothing to commit, working tree clean`. Jarvis treats that as fatal
and **aborts the whole run** (exit 1), so remaining subspecs never execute —
leaving multi-subspec specs partially converted but committed.

Observed on `groceries-client` cva refactors (haiku patch agent): a 5-subspec
spec landed all 5 components yet still exited 1 on the final completion commit;
three other specs aborted after subspec 0–1. Worktrees show agent-style commits
(`Extract EmptyState …`) interleaved with jarvis completion commits. Models that
self-commit are common; the harness shouldn't lose the run over it. Intake #547.

## Direction

When the per-subspec completion `git commit` finds nothing to commit, **don't
abort**: detect that the subspec's changes are already committed (agent
self-committed) and continue — skip the empty commit (or amend/relabel the
agent's commit to the completion message) and proceed to the next subspec.
Optionally also instruct the patch agent not to create commits, but the harness
must be robust to it regardless.

## Out of scope

- Forcing a specific agent's commit behavior as the *only* fix — the harness
  must tolerate self-committing agents.

## References

- Per-subspec completion commit path in `v1/src/modes/patch/`.
- Intake issue #547.
