---
name: checkpoint-partial-progress-on-iteration-timeout
---

# Patch run should checkpoint partial progress on iteration-timeout so resume builds forward

When a subspec's implementation exceeds the 10-min `iterationTimeoutMs` wall, the agent is
killed (exit 8) with `iterations: 0` and **no partial work committed**. The killed agent's
edits linger uncommitted in the worktree, but a re-run/resume does not reliably build on
them — each fresh agent re-does the same wiring and hits the wall again.

Observed 2026-07-10 on `ready-gate-scope-tests-by-changed-path` subspec 01 (wire 6 gate call
sites + their tests): **three** consecutive 10-min timeouts across `claude`, `cursor`, and
`opencode/glm-5.2`. Cursor got furthest (finished subspec 00, wired most of 01) but its
progress was never committed as a checkpoint, so it was neither resumable nor ticked. The
operator had to manually finalize: verify the accumulated agent work, complete an unfinished
test file (~48 `--merge` tests left un-`await`ed after an async signature change), tick AC,
and hand-merge — exactly the manual intervention the north-star wants eliminated. The subspec
is legitimately too large for one iteration; there is no escape hatch.

## Decisions

- On iteration-timeout with uncommitted agent edits present, **commit them as a WIP
  checkpoint** (un-ticked AC stays un-ticked) so the next resume continues forward instead of
  restarting the subspec. The existing no-commit auto-reset already handles un-ticking; this
  adds a forward-progress commit for the code delta.
- Ensure the resume path points the next agent at the existing in-worktree partial work rather
  than prompting a fresh start.
- Consider detecting **repeated** timeouts on the same subspec and surfacing a clear
  "subspec too large — split it" signal (planning gap) instead of silently re-walling.

## Out of scope

- Raising `iterationTimeoutMs` globally (the wall is a defect-catcher, not tolerated runtime —
  a normal op riding it is a bug to fix, not a limit to lift).
- Reducing gate/review passes (separate speed lever).

## Documentation updates

- `v1/docs/operator-runbook.md` (§ Manual-finalize recovery): note that exit-8 timeouts now
  checkpoint partial progress, so a resume no longer restarts the subspec from scratch; drop
  the implication that the operator must hand-reconcile accumulated uncommitted work.
- `v2/docs/v1-behaviors.md`: record the iteration-timeout checkpoint-commit behavior.
