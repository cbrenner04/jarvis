# 01 - Arm reprompt invocations with the same idle budget

## Problem

The token reprompt and blocker reprompt are their own `executeWithQuotaFallback` calls in
`step-runner.ts`. Left unarmed, an agent that goes silent only during a reprompt still rides the
iteration wall, and its stalled reprompt surfaces as `invalid_token` / `missing_blocker` rather
than as an idle failure.

## Decisions

- Both reprompt call sites receive the same `idleOutputMs` as the primary step invocation; rules out a separate reprompt-specific budget.
- A stalled reprompt settles the step as `idle_output_timeout`, not `invalid_token` / `missing_blocker`; rules out attributing a silent agent to malformed output.

## Acceptance criteria

- [ ] A write-loop test drives a silent token reprompt (first response carries no terminal token, reprompt emits nothing) and asserts `idle_output_timeout`, not `invalid_token`; omitting `idleOutputMs` on the token-reprompt call site fails it.
- [ ] A write-loop test drives a silent blocker reprompt (blocked token, unsatisfied blocker contract, silent reprompt) and asserts `idle_output_timeout`, not `missing_blocker`; omitting `idleOutputMs` on the blocker-reprompt call site fails it.
- [ ] A test drives a healthy reprompt that emits a terminal token and asserts the step settles on that token with no idle outcome.
- [ ] With `idleOutputTimeoutMs: 0`, a silent reprompt produces no `idle_output_timeout` — inverting the disable guard fails this test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — reprompt invocations share the iteration's idle budget and can settle `idle_output_timeout`.
