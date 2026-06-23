# Retry completion ready gate on red

## Problem

The completion ready gate (`runCompletionReadyGate` in
`v1/src/modes/patch/completion-pipeline.ts`) runs the target repo's ready command
once at the full tier. When that command flakes — passes in-worktree, fails under
the full parallel run — the gate reads the red as deterministic and the caller
immediately enters the fix-up loop, burning iterations and editing correct work
to chase a non-deterministic failure.

The gate already does a test-step serial retry *inside* a single run
(`scripts/ready.ts`), but a whole-gate flake (e.g. a command failing only under
parallel load that the inner serial retry does not cover) still surfaces as red on
the first and only whole-gate execution.

## Behavior

When the completion gate returns red, re-run the same gate unchanged — no agent
invocation, no edits between runs — up to a fixed bound. If any re-run passes,
finalize completion normally (record the green completion-transition result, run
shrink/review/`maybeMarkReady`). Enter fix-up handling only when the gate fails on
the initial run and every retry — i.e. it is deterministically red.

This distinguishes a flaky gate from a real failure cheaply, before any
contaminating fix-up edit.

## Decisions

- Retry bound: 2 retries (3 total whole-gate executions). Rules out unbounded
  retry and single-retry; two green chances before believing red, bounded to cap
  the cost of full-tier reruns.
- Scope: only the completion-transition gate (`runCompletionReadyGate`). Shrink,
  review, and `maybeMarkReady` gate sites are unchanged. Rules out applying the
  retry at all five gate sites.
- The retry re-runs the identical whole gate (`runReadyAndCommit` full tier, or
  the `opts.runCompletionReadyGate` seam) — not just the failing step. Rules out a
  narrower re-run; the inner test-step serial retry composes within each run.
- Harness makes no edits between retries; each run's own `check:fix:unsafe` commit
  is part of that gate run, as today. Rules out freezing the tree across retries.
- Retries apply on every completion-gate invocation, including the gate re-check
  after a fix-up iteration. Rules out first-invocation-only retry.
- A pass on any attempt takes the same green path as a first-try pass (records the
  HEAD-keyed completion-transition green result). Rules out skipping the
  recorded-green optimization on a retried pass.
- The bound is a fixed harness constant, no per-project config (per the intent's
  out-of-scope note).

## Task checklist

- [ ] Add bounded whole-gate retry-on-red inside `runCompletionReadyGate`.
- [ ] On a passing attempt, return green so the existing green path records the
  completion-transition result.
- [ ] Return red (with the final attempt's failure text) only after all attempts
  fail; leave the caller's stuck-red / loop-back logic untouched.
- [ ] Emit an operator-visible log line on each retry and on retry-recovery.
- [ ] Tests: red-then-green seam → green completion, no fix-up; all-red seam →
  existing red handling (loop-back).
- [ ] Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] On a red completion ready gate, the harness re-runs the same gate unchanged,
  with no agent invocation between runs, up to a fixed bound before treating it as
  red.
- [ ] If any re-run of the completion gate passes, the run finalizes completion
  normally (records the green completion-transition result, then
  shrink/review/`maybeMarkReady`) and no fix-up iteration is launched.
- [ ] Fix-up handling is entered only when the completion gate fails on the initial
  run and every retry; the caller's stuck-red and loop-back behavior is otherwise
  unchanged.
- [ ] A test injecting a completion gate (`opts.runCompletionReadyGate`) that
  returns red then green yields a green completion with no fix-up iteration.
- [ ] A test injecting an always-red completion gate launches the fix-up loop /
  preserves the existing red handling (loop-back, stuck-red exit 10).
- [ ] Operator-visible log output distinguishes a gate that passed on a retry from
  a first-try green.
- [ ] The retry bound is a fixed harness constant with no per-project config knob.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — "Completion-transition ready gate" section: document
  that a red gate is re-run unchanged up to the fixed bound before being treated as
  red, and that any passing attempt finalizes completion normally.
- [ ] `v2/docs/v1-behaviors.md` — update the completion-gate-red behavior
  (currently: red → immediate loop-back handling) to record the retry-before-red
  step and the bound; cite `v1/src/modes/patch/completion-pipeline.ts`.
