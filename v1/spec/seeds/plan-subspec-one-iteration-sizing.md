# Plan drafts subspecs too large for one patch iteration

## Problem

The plan loop routinely drafts individual subspecs whose implementation cannot
complete within one 10-minute patch iteration, across every agent tier. Observed
2026-07-11 driving the v2 operator-workflow seeds: three separate subspecs
(`intent-workflow-reviewed/01`, `plan-workflow-draft/00`, `plan-workflow-draft/02`)
each timed out (exit 8) on haiku **and** opus with zero or truncated file
activity, and required the operator to hand-split them into 2–3 smaller subspecs
before a fresh run completed. The over-build is the "precision amplifier"
pattern: a small seed intent expands into a subspec with 13+ dense decisions and
10+ acceptance criteria spanning several independent code paths.

The existing auto-split blocker (three consecutive iteration timeouts on one
active subspec → append `## Blocker`, exit 7) fires **within a single run**, but
fresh runs that each time out once never accumulate to three, so the operator
absorbs the split as manual spec surgery (branch → rewrite subspecs → renumber
index → PR → merge → re-run).

## Decisions

- Bias the plan draft/review prompt toward subspecs sized for one patch
  iteration — one code path / one test file per subspec, decisions and AC
  counts bounded — rather than maximally-precise monoliths. A subspec that names
  three independent code paths (builder + runtime wiring + validator) is three
  subspecs.
- Consider a plan-time size heuristic or reviewer check that flags a subspec
  likely to exceed one iteration (decision/AC/code-path count) and asks the plan
  loop to split it before the spec merges.
- Consider making the over-build recoverable without hand surgery: e.g. a
  `jarvis1 plan --resume <index.md> --split <subspec>` (or the auto-split
  blocker triggering across fresh runs, not only within one run) so a
  repeatedly-timing-out subspec is re-planned into smaller pieces by the harness.

## Prerequisites

- none

## Out of scope

- Raising `iterationTimeoutMs` above 10 min (a normal op riding that wall is a
  defect to fix, not tolerated runtime — per operator runbook).

## Reference

- Operator runbook § Branch-before-edit discipline (split-signal), § Manual-finalize recovery.
- Memory notes: plan-refine-precision-amplifier, plan-prompt-coherence-principle.

## Documentation updates

- `v1/docs/operator-runbook.md` — the manual subspec-split recovery procedure
  (abandon worktree → split on a branch → renumber index → PR → re-run) added
  this session as a stopgap; remove it once this ships.
