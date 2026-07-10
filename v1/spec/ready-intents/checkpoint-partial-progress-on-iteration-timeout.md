---
name: checkpoint-partial-progress-on-iteration-timeout
---

# Commit uncommitted agent edits as a WIP checkpoint when iteration-timeout kills the agent

On exit-8 (iteration-timeout), a killed agent's edits currently linger uncommitted in the
worktree. Observed 2026-07-10: three consecutive 10-min timeouts on one subspec across
`claude`/`cursor`/`opencode` each re-did the same wiring from scratch because no partial
progress was ever committed, forcing manual finalize by the operator.

## Decisions

- On iteration-timeout with uncommitted agent edits present (git-tracked, non-no-commit-mode
  worktree), commit them as a WIP checkpoint — rules out silently discarding or leaving the
  edits uncommitted, both of which force the next iteration to restart the subspec.
- Do not tick any acceptance criteria as part of this commit — the checkpoint is code-only,
  not a completion signal.
- This is additive to the existing no-commit auto-reset (`no-commit-delta.ts`), which only
  applies to `git: false` external-spec runs and un-ticks AC/blockers; it does not apply here.

## Out of scope

- Raising `iterationTimeoutMs` globally.
- Changing what the next iteration's prompt says about the checkpoint (separate intent).
- Detecting repeated timeouts on the same subspec (separate intent).

## Documentation updates

- `v1/docs/run-loop.md` § "Stop conditions and exit codes": note exit-8 now commits a WIP
  checkpoint of uncommitted edits before returning.
- `v1/docs/operator-runbook.md` (§ Manual-finalize recovery): drop the implication that the
  operator must hand-reconcile accumulated uncommitted work after a timeout.
- `v2/docs/v1-behaviors.md`: record the iteration-timeout checkpoint-commit behavior.

## Prerequisites
