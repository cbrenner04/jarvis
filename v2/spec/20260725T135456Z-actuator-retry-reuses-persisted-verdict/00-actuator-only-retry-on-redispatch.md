# 00 - Actuator-only retry on re-dispatch

## Problem

After a committed implement write step, a `review-debate` actuator failure (`failureKind:
"timeout"` or `"stall"`) leaves the adjudicated verdict at `verdictPath`. Operator recovery is
still re-dispatching the same workflow, but the runner replays the hidden post-implement shrink pass
and the adversary → advocate → adjudicator chain before reaching the actuator again.

## Prerequisites

- The adjudicated verdict is written to `verdictPath` before the actuator is invoked.
- Actuator failure is distinguishable from debate-role failure on the persisted last-attempt
  `invocationFailureDetail` (`role` + `failureKind` together).

## Decisions

- Re-dispatch after a failed actuator on a `review-debate` step with a persisted verdict re-enters
  review at the actuator only — rules out replaying the debate roles to re-derive the verdict.
- Actuator-only retry uses the same actuator prompt path as the first attempt (including
  `profile.render.actuator` when configured), feeding the unchanged `verdictPath` content — rules
  out a raw-verdict bypass that skips configured rendering.
- The same re-dispatch must not invoke the implement write agent or the hidden `~shrink` pass when
  the implement step is already checkpoint-complete — rules out firing the post-implement shrink
  block on every `complete` implement return during workflow replay.
- Eligibility is the durable review run's last attempt `invocationFailureDetail` with `role:
  "actuator"` and post-commit retryable `failureKind` (`timeout` or `stall`) — rules out wiring a
  top-level run-row `failedRole` or treating adjudicator or other debate-role failures as
  actuator-only retries.
- On eligible actuator-only re-dispatch, reuse the same durable review run row (`runId`) and record a
  new attempt — rules out creating a parallel review run per re-dispatch (same store reuse model as
  existing implement-review re-dispatch tests).
- Missing or empty `verdictPath` on actuator-only retry (both `timeout` and `stall` eligibility)
  settles a named preflight-style error citing the path — rules out falling back to a full debate
  cycle or full workflow re-run.
- Operator recovery remains re-dispatching the same workflow invocation (not `jarvis run resume`
  on the review row) — rules out a new CLI surface for actuator-only retry.
- Scope is `review-debate` implement patch review in this change — rules out extending
  critic/actuator `review` steps here; defer unless a shared helper already covers both paths.
- Multi-cycle implement review (`maxCycles` / multiple passes) and `freshDispatch` are out of scope
  unless admission is limited to the last cycle failing at actuator with a persisted verdict;
  single-cycle implement presets are in scope.
- Last-rung / exhausted-rung timeout guidance in the runbook still applies to non-actuator review
  failures; actuator-only retry changes operator expectations only where `verdictPath` already holds
  the adjudicated verdict.

## Acceptance criteria

- [ ] A new or strengthened `workflow-runner.test.ts` case uses a shrink-exercising implement fixture
      (`createShrinkTestStep` or equivalent) so the first pass runs shrink, drives implement + patch
      `review-debate` to an actuator `timeout` after commit, re-dispatches the same steps on the
      same store, and asserts the second pass invokes no implement write agent, no shrink prompt, no
      adversary/advocate/adjudicator bindings, exactly one actuator against unchanged `verdictPath`
      content, and the same review `runId` with one additional attempt; it fails against the
      pre-fix code.
- [ ] The same test shape with `failureKind: "stall"` stays green after the change (shares the
      missing/empty `verdictPath` guard with `timeout`).
- [ ] Re-dispatch after actuator `timeout` with `verdictPath` removed or empty fails with an error
      message naming `verdictPath`; it fails against the pre-fix code.
- [ ] Re-dispatch after a debate-role (non-actuator) `timeout` or `stall` on the same
      `review-debate` step does not take actuator-only admission; debate and shrink replay behavior
      stays as today (new negative case; fails against the pre-fix code if mis-wired).
- [ ] A guard on the actuator-only retry admission path asserts debate roles and shrink are skipped
      when eligible; inverting the guard causes the primary re-dispatch test to fail.
- [ ] `review-debate.test.ts` stays green.
- [ ] `workflow-runner.test.ts` cases `re-dispatching after review-debate timeout does not re-run
      the implement write step` and `re-dispatching after review-debate stall does not re-run the
      implement write step` are strengthened or replaced so they assert the full skip contract (no
      shrink or debate replay on the second pass), not only zero implement invocations.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — post-commit actuator timeout/stall re-dispatch reads the persisted
  verdict and re-invokes only the actuator; shrink and debate roles are not replayed.
- `v2/docs/operator-runbook.md` — recovering a failed actuator: re-dispatch the same workflow;
  expect actuator-only replay, not write/shrink/debate; reconcile paragraphs that imply ~30 minutes
  of full write/shrink/debate replay or generic checkpoint reuse so actuator timeout/stall with
  verdict on disk is distinct from debate-role failures and other recovery paths (last-rung timeout
  guidance unchanged for non-actuator failures).
- `v2/docs/v1-behaviors.md` — v2 additive note on actuator-only review retry semantics.
