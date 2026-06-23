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
- Tree state between retries: a red run leaves its `check:fix:unsafe` output
  **uncommitted** — the gate's `git add -A`/commit runs only after ready succeeds,
  while `check:fix:unsafe` runs first, so a red never commits. Retries re-run
  against that already-normalized dirty tree. This is safe because the mutation is
  idempotent formatting/lint, not source edits; the *harness* makes no edits
  between retries — only the gate's own idempotent auto-fix runs. The eventual
  green run's existing `git add -A` commit absorbs the accumulated auto-fix output.
  Rules out the false claim that each red commits its own fix, and rules out
  freezing the tree across retries.
- Retries apply on every completion-gate invocation, including the gate re-check
  after a fix-up iteration. Rules out first-invocation-only retry.
- A pass on any attempt takes the same green path as a first-try pass (records the
  HEAD-keyed completion-transition green result). The green attempt's `git add -A`
  absorbs any prior red attempt's uncommitted auto-fix output and asserts a clean
  worktree before returning, so HEAD recording on a retried pass operates on a
  committed-everything clean tree exactly as a first-try pass does. Rules out
  skipping the recorded-green optimization on a retried pass.
- Cost compounding: because retries apply to every completion-gate invocation
  (including post-fix-up re-checks), a deterministically-red spec pays up to
  (retry bound × consecutive-red-fixup bound) full-tier gate executions before the
  stuck-red exit. Accepted as a CPU/wall-clock-only cost (zero agent tokens) on the
  rare deterministic-failure path; "cheap" is relative to the avoided alternative —
  entering the fix-up loop, which spends agent invocations and edits correct work.
  Rules out silently absorbing the worst-case multiplier.
- Seam arity: `opts.runCompletionReadyGate` moves from exactly-once to up-to-N
  invocations per gate. Rules out leaving the seam-contract change implicit for
  reviewers and tests.
- Red return value is the final attempt's failure text feeding stuck-red
  comparison. Matches today's single-run semantics (the last thing the gate saw)
  and the comparison normalizer already strips transient deltas.
- Telemetry: operator log line only, no new structured telemetry marker; the
  existing gate-terminal telemetry is unchanged. Rules out silently omitting a
  telemetry decision in code that emits structured telemetry at every gate terminal.
- The bound is a fixed harness constant, no per-project config (per the intent's
  out-of-scope note).

## Task checklist

- [ ] Add bounded whole-gate retry-on-red inside `runCompletionReadyGate`.
- [ ] On a passing attempt, return green so the existing green path records the
  completion-transition result.
- [ ] Return red (with the final attempt's failure text) only after all attempts
  fail; leave the caller's stuck-red / loop-back logic untouched.
- [ ] Emit an operator-visible log line on each retry and on retry-recovery
  (operator log only; no new telemetry marker).
- [ ] Tests: red-then-green seam → green completion, no fix-up; all-red seam →
  loop-back (return null). Update any existing test asserting always-red seam
  invocation count (always-green is unaffected — it short-circuits on attempt 1).
- [ ] Real-path coverage: either add a test asserting a green-after-red
  `runReadyAndCommit` run yields a clean, HEAD-recordable worktree, or state
  explicitly in the test plan that the real dirty-tree-across-retries path is
  uncovered and why (the seam never touches the worktree). Do not imply coverage
  the seam tests lack.
- [ ] Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] On a red completion ready gate, the harness re-runs the same gate unchanged,
  with no agent invocation between runs, up to a fixed bound before treating it as
  red.
- [x] If any re-run of the completion gate passes, the run finalizes completion
  normally (records the green completion-transition result, then
  shrink/review/`maybeMarkReady`) and no fix-up iteration is launched.
- [x] Fix-up handling is entered only when the completion gate fails on the initial
  run and every retry; the caller's stuck-red and loop-back behavior is otherwise
  unchanged.
- [x] A test injecting a completion gate (`opts.runCompletionReadyGate`) that
  returns red then green yields a green completion with no fix-up iteration.
- [x] A test injecting an always-red completion gate on first invocation yields
  loop-back (return null) — the seam is invoked up to the bound, then the existing
  red handling returns null (no prior failure text → not stuck-red exit 10).
- [x] A green-after-red `runReadyAndCommit` run leaves a clean, HEAD-recordable
  worktree (real-path coverage), or the test plan states this path is uncovered and
  why; the seam tests do not imply they cover it.
- [x] Operator-visible log output distinguishes a gate that passed on a retry from
  a first-try green; no new structured telemetry marker is added.
- [x] The retry bound is a fixed harness constant with no per-project config knob.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — "Completion-transition ready gate" section: document
  that a red gate is re-run unchanged up to the fixed bound before being treated as
  red, and that any passing attempt finalizes completion normally.
- [ ] `v2/docs/v1-behaviors.md` — update the completion-gate-red behavior
  (currently: red → immediate loop-back handling) to record the retry-before-red
  step and the bound; cite `v1/src/modes/patch/completion-pipeline.ts`.
