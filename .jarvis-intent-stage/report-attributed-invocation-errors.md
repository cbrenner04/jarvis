---
name: report-attributed-invocation-errors
---

# Report attributed invocation errors

## Prerequisites

- Every entered binding attempt, including one that fails before returning a typed result, is represented with its binding outcome and emits one attributed `invocation_completed` row when telemetry is configured before the invocation chain settles.
- Terminal binding-chain failure settlement persists every attempted rung's binding, agent, model, and outcome, marks whether its bounded diagnostic is echoed input, and writes the raw bounded diagnostic to the structured run log without changing ordinary real-stderr bytes.

## Module-boundary surface

- Daemon `run list` / `run wait` operator-error composition in `v2/src/daemon/`

## Problem

Daemon operator-error composition projects a persisted prompt echo as the `invocation_error` diagnosis and omits the attempted binding chain from the settled error.

## Behavior

- A settled `invocation_error` whose diagnostic is echoed input reports the failure class and every attempted binding instead of the echo, while a failure carrying real stderr keeps projecting that stderr unchanged.

## Decision ledger

- Compose prompt-echo summaries from the durable failure classification and ordered binding attempts; rules out presenting captured input as a diagnosis or consulting transient process state.
- Name `bindingId`, agent, model, and outcome for each attempted rung in chain order; rules out attributing only the final rung or the configured flat agent list.
- Keep the existing real-stderr projection unchanged when the diagnostic is not echoed input; rules out replacing useful agent errors with generic prose.
- Keep `invocation_error` retryability, next action, and exit semantics unchanged; rules out broadening a diagnostic repair into recovery-policy changes.

## Acceptance criteria

- [ ] `v2/src/daemon/run-operator-error.test.ts` proves prompt-echo failure detail composes an `invocation_error` message naming the failure class and every attempted binding in order without including the echoed prompt; it fails against the pre-fix verbatim-message projection.
- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` proves `run list` and `run wait` expose the same attributed prompt-echo error for a settled run.
- [ ] `v2/src/daemon/run-operator-error.test.ts` proves ordinary failure detail carrying real stderr still projects that stderr unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Review-role timeouts and stalls: `invocation_error` names the failure class and attempted bindings when captured stderr is echoed input.
- `v2/docs/daemon-host.md` — binding-chain attribution and prompt-echo suppression in composed operator errors.
- `v2/docs/v1-behaviors.md` — record the changed v2 list/wait projection.
