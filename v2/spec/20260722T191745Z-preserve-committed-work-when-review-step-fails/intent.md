---
name: preserve-committed-work-when-review-step-fails
---

# Preserve committed work when a review step times out

## Problem

When the review actuator's invocation fails on its bound, `runReviewDebateStep` /
`runProfileReviewStep` settle the run `failed` / `invocation_error`, `resumable: false`,
`nextAction: stop`, and publish nothing — discarding an implementation that had already committed
(`8e405d86` in the 2026-07-22 observation) and the adjudicated verdict that preceded the actuator.
The operator's only recourse was re-running with `--review-passes 0`, dropping review entirely.

## Decisions

- A review step that fails on a timeout after the implementation committed leaves the commit and the
  adjudicated verdict intact and settles resumable/actionable; rules out today's all-or-nothing
  discard.
- The write step's own outcome is untouched by the review step's failure; rules out rolling the
  implement/shrink checkpoint back.
- Do not auto-land the PR on a timed-out review; the operator decides. Rules out treating a
  half-applied review as complete.
- Scope is timeout-triggered review-step failure only; a non-timeout review failure (genuine error)
  keeps today's settle behavior. Rules out reworking all invocation-failure settle paths under a
  timeout-recovery change.

## Acceptance criteria

- [ ] Regression coverage drives an actuator timeout after a committed implementation and asserts
      the run retains the commit and the adjudicated verdict; it fails against the current discard
      behavior.
- [ ] The resulting run state is actionable — the operator can land or resume without re-running the
      write step.
- [ ] A review step that completes normally lands unchanged.
- [ ] A non-timeout review-step invocation failure settles exactly as it does today.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — settle semantics when a review step times out after a commit.
- `v2/docs/operator-runbook.md` § Gate trust — recovering a timed-out review step.
- `v2/docs/v1-behaviors.md` — updated review-step settle behavior on a post-commit timeout.

## Prerequisites

- A role-invocation timeout is classified and attributed distinctly from a generic invocation error
