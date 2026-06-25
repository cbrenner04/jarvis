---
name: ready-gate-flake-retry-coverage-and-exit10-markready
---

# Flaky readyCommand still strands correct work at ready-stuck-red (exit 10)

## Problem

A flaky project `readyCommand` (e.g. groceries-client `npm run test:ci`,
intermittently failing on polling tests under the full parallel run) drives a
`run` to exit `10` (`ready-stuck-red`) on **correct** work, leaving the PR a
draft; the fix-up loop then chases the flake with out-of-scope edits that
contaminate the diff.

Much of the mitigation already shipped — the per-project `readyGateRetryBound`
knob (`v1/src/config.ts`, default 2 ⇒ 3 attempts) re-runs the gate on
`retryable` red in `v1/src/modes/patch/completion-pipeline.ts`. But two genuine
gaps remain:

- The retry knob shipped **without test coverage** (its own plan verdict flagged
  this); behavior is unguarded against regression.
- On exit `10` there is **no first-class, low-friction recovery**: the operator
  verifies green in the worktree by hand, then marks ready manually. The
  north-star path "operator verified green → mark ready" is not owned by any
  command.

Surfaced via groceries-client batch (intake issue #519). Note: a sustained-flaky
full-suite gate may also need the bound (or flake classification) revisited —
3 attempts didn't clear it there.

## Direction

- Add the missing test coverage for `readyGateRetryBound` (retries on retryable
  red up to the bound; does not retry non-retryable failures).
- Fold a low-friction exit-`10` recovery into an **existing** command (re-run the
  gate once in the worktree and, if green, mark the PR ready) rather than the
  manual `gh pr ready` dance — no new subcommand if avoidable.
- Weigh whether the default bound / retryable-classification adequately covers a
  flaky whole-suite `readyCommand`.

## Out of scope

- Test-level flaky-vs-real quarantine inside the target project's suite (that is
  the target repo's job, not the harness's).
- Operator-side config: a flaky-gate project should also set `readyGateRetryBound`
  — call out in the issue, not a harness change.

## References

- `v1/src/modes/patch/completion-pipeline.ts` — gate retry loop + exit-10 logic.
- `v1/src/config.ts` — `readyGateRetryBound` field + default.
- `v1/docs/run-loop.md` — exit-10 `ready-stuck-red` section.
- Intake issue #519; completed `per-project-ready-gate-retry-knob`,
  `retry-ready-gate-on-red-before-fixup`.
