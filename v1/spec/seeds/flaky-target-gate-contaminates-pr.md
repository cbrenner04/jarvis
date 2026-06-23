---
name: flaky-target-gate-contaminates-pr
---

# Flaky target-repo gate burns fix-up iterations and contaminates the PR

## Problem

When the target repo's `readyCommand` flakes (passes in-worktree, fails under the full parallel
run), the post-completion fix-up loop reads the red gate as a real failure and keeps editing to
chase it. Observed in groceries (`SESSION_REPORT.md`, "#F1 ready-stuck-red"): #14's change was
correct, but the client `test:ci` suite flakes on polling tests, so the gate failed **all 4 fix-up
iterations** — ~35 min / $4.21 burned on correct work, and the fix-up edits **contaminated the PR**
chasing an unrelated flake. Verified green in-worktree and salvaged by hand.

The harness can't currently tell "the change is wrong" from "the gate is flaky," so a flaky gate
turns a finished, correct spec into cost + bad diffs.

## Direction

Make a flaky gate non-destructive. Options for plan to weigh:

- **Retry-on-red before editing**: re-run the gate N times unchanged; only enter the fix-up loop if
  it fails deterministically (distinguishes flake from real failure cheaply).
- **Quarantine fix-up edits**: if the gate stays red after a bounded fix-up budget, *discard* the
  fix-up commits rather than leave them on the PR, and surface "gate red after N tries — flaky or
  real? finalize by hand" instead of shipping a contaminated diff.
- A per-project `readyRetries` / `gateFlaky` knob so known-flaky suites get retried, not chased.

## Out of scope

- Stabilizing the target repo's own flaky tests (target-side work; this is harness resilience to it).
- Jarvis's *own* flaky-test handling (already covered by prior serial-retry/determinism specs).

## References

- `v1/src/modes/patch/run.ts` — post-completion gate + fix-up loop.
- `v1/spec/completed/2026-06-22T19-34-03Z-custom-ready-gate-command/` — `readyCommand` override.
- Observed 2026-06-22/23 on groceries `#14 fold labels` (`../groceries/specs/jarvis/SESSION_REPORT.md`).
