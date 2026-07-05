---
name: review-debate-behavior
---
# Review Debate Behavior

# Review-debate workflow behavior

Add `review-debate` as a supported workflow step behavior alongside `write`.
One cycle: read-only adversary → advocate → adjudicator produce a verdict;
a separate actuator (the only writer) applies it. Verdict persists next to
the target artifact, overwritten each cycle. Empty verdict skips the
actuator. Cycles run up to a configured bound `N` (default 1). Reviewers and
actuator resolve `(agent, role) → rungs` same as write steps. Emit
`invocation_completed` telemetry rows for each debate-role and actuator
invocation, same schema as write-step rows (`workflow`, `step_id`, `role`
differ per `telemetry-capture.md`).

## Prerequisites

- workflow runner dispatches steps by `behavior`, with only `write` supported today
- role resolution defines `adversary`, `advocate`, `adjudicator`, `actuator` as read-only-debate-then-actuator roles
- shared invocation layer resolves `(agent, role) -> rungs` via the agent-model-config store
- `invocation_completed` telemetry emission exists for write-step invocations at the shared invocation seam
