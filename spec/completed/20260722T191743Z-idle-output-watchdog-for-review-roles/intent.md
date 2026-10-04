---
name: idle-output-watchdog-for-review-roles
---

# Arm the idle-output watchdog on review role invocations

## Problem

`invokeReviewRole` passes no `idleOutputMs`, so the wall clock is v2's only bound on a review role: a
productive-but-slow actuator and a hung one both ride to 600s and are indistinguishable. v1 arms
both bounds (`v1/src/modes/patch/review.ts:942` abort plus `DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000`,
`v1/src/config.ts:137`). Shared invocation already honours a caller-supplied `idleOutputMs`
(`shared/invocation/agents.ts`); nothing in v2 supplies one.

## Decisions

- Supply an idle-output budget to review role invocations rather than shortening the wall clock;
  rules out a tighter wall clock, which kills slow-but-working actuators just as blindly.
- Report an idle-output kill distinctly from a wall-clock abort; rules out collapsing both into one
  timeout reason and losing the slow-vs-hung distinction the change exists to make.
- Keep `iterationTimeoutMs` unchanged globally and leave the write step's bounds alone; rules out
  masking a slow actuator by giving every role longer.
- Deferred to first consumer: per-role/per-behavior idle budgets. Pin one review-path default now
  and pin per-profile values when a caller needs them.

## Acceptance criteria

- [ ] A review role invocation that keeps emitting output past the idle bound is not killed.
- [ ] A review role invocation silent past the idle bound is killed and reported as an idle-output
      kill, distinct from the wall-clock abort.
- [ ] The write step's existing bounds are unchanged.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/invocation-liveness.md` — the review path's enforced stdout/stderr idle budget, and what
  remains deferred.
- `v2/docs/workflow-runner.md` — per-role invocation bounds.
- `v2/docs/operator-runbook.md` § Gate trust — reading an idle-output kill vs a wall-clock abort.
- `v2/docs/v1-behaviors.md` — review role invocations now carry an idle-output bound.

## Prerequisites

- Shared invocation honours a caller-supplied `idleOutputMs` budget and aborts the invocation on idle
- A role-invocation timeout is classified and attributed distinctly from a generic invocation error
