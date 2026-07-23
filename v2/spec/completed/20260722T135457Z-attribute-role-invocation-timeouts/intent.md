---
name: attribute-role-invocation-timeouts
---

# Attribute role-invocation timeouts in the run row

## Problem

`invokeReviewRole` (`v2/src/execution/review-role-invocation.ts`) arms a wall-clock abort at
`DEFAULT_ITERATION_TIMEOUT_MS`; when it fires, the invocation surfaces as a bare `error` and the run
settles `invocation_error` naming no role, agent, model, or bound. Observed 2026-07-22 on
`20260722T015205Z-runtime-smoke-exercises-cli-daemon-handshake`: the only way to learn the actuator
timed out was reading `duration_ms` ≈ 600000 in `~/.jarvis/telemetry.jsonl`.

## Decisions

- Classify a bound-exceeded role invocation distinctly from a generic `error`; rules out reusing
  `error` and forcing telemetry archaeology.
- Record role, agent, model, and the bound value on the run row's invocation-failure detail; rules
  out a message-only string the operator must parse.
- Applies to every role invoked through `invokeReviewRole` (critic, actuator, debate roles), not
  just the actuator; rules out an actuator-only special case in a shared helper.
- Do not change any bound's value; rules out folding a timeout-tuning change into an attribution
  change.

## Acceptance criteria

- [ ] A role invocation that exceeds its wall-clock bound settles with a failure naming the role,
      agent, model, and the bound value.
- [ ] The bound-exceeded classification is distinguishable from a generic invocation `error` by run
      readers, not only by message text.
- [ ] Tests pin both directions: a timed-out invocation reports the attributed timeout; a
      non-timeout invocation failure keeps its existing classification.
- [ ] A normal-duration role invocation is unaffected.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — per-role invocation bounds and timeout attribution.
- `v2/docs/operator-runbook.md` § Gate trust — how a timed-out review step is reported.
- `v2/docs/v1-behaviors.md` — invocation-failure classification now distinguishes bound-exceeded.

## Prerequisites
