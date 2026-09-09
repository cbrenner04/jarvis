# Attributed prompt-echo operator error

## Problem

The write loop already suppresses the echo: a settling binding whose stderr echoes the dispatched prompt persists `echoedInput: true` with no `message` (`write-loop.ts` sets the two in mutually exclusive branches). `composeRunOperatorError` only ever attaches a `message` to `invocation_error` when `failureKind === "error"` and `detail.message !== undefined` — so an echoed `error`-kind failure composes `invocation_error` with no `message` and no attribution at all, even though the persisted `bindingAttempts` chain names every attempted binding. An operator sees a bare `invocation_error` with nothing to act on.

## Decisions

- Gate on `detail.failureKind === "error" && detail.echoedInput === true` only; rules out also attaching a new message to `quota`/`model_config`/`no_binding`/`landing`/`timeout`/`stall` failures, none of which project a message today, and rules out touching `model_config`'s separate `projectModelConfigMessage` path. The exhausted-role-timeout re-map (`isExhaustedRoleTimeout`) only ever fires for `failureKind: "timeout"`, so it never reaches this gate.
- Compose the message from `failureKind` and persisted `bindingAttempts` only; rules out reading `detail.message` (always undefined on this path by write-loop invariant) or any live process/telemetry state.
- Message opens with the operator-facing reason token `invocation_error`, not the raw `failureKind: "error"`; rules out a bare "error" token that duplicates ambiguity already resolved by the `reason` field.
- Name `bindingId`, agent, model, and `resultKind` for every attempted rung in persisted chain order, rendering an absent `agent`/`model` as a fixed placeholder (`"unknown-agent"`/`"unknown-model"`) rather than omitting the field; rules out silently dropping a rung or a missing attribute.
- Compose a failure-class-only message (no binding text) when `bindingAttempts` is empty; rules out falling back to the echoed message or omitting `message`.
- Truncate the composed message to 2048 code units, the same bound `write-loop.ts` already applies to the stderr tail; rules out an unbounded attempt-chain string crossing the daemon wire.
- Leave `retryable`, `nextAction`, and reason mapping for `invocation_error` untouched; rules out widening a diagnostic repair into recovery policy.
- Deferred to first consumer: attaching `bindingAttempts` to non-echoed `error`-kind failures (which already project real stderr) or to null-detail failures — pin when an operator workflow needs binding attribution beyond the echoed-input case.

## Acceptance criteria

- [x] `v2/src/daemon/run-operator-error.test.ts` proves a settled `invocation_failure` detail with `failureKind: "error"`, `echoedInput: true`, and two `bindingAttempts` composes an `invocation_error` whose `message` names the failure class and both rungs' `bindingId`, agent, model, and `resultKind` in chain order; it fails against the pre-fix code, which composes no `message` field at all for this detail.
- [x] `v2/src/daemon/run-operator-error.test.ts` proves an `echoedInput: true`, `failureKind: "error"` detail with empty `bindingAttempts` composes an `invocation_error` message naming the failure class and no bindings; it fails against the pre-fix code's message-less composition.
- [x] `composeRunOperatorError projects binding-chain invocation stderr when present and omits it when absent` (existing test) stays green — non-echoed `error`-kind stderr passthrough is unchanged.
- [x] `composeRunOperatorError differs for stall vs error failureKind` and the `composeRunOperatorError does not project message for %s invocation failure` cases (existing tests) stay green — `reason`, `retryable`, and `nextAction` for `invocation_error` and sibling failure kinds are unchanged.
- [x] `v2/src/daemon/daemon-wait-run-completion.test.ts` gains a case, alongside `list and wait project persisted binding-chain invocation stderr onto the operator error`, proving `run list` and `run wait` expose the identical composed `invocation_error` for one settled prompt-echo run — preservation of existing shared-composition parity (both entry points consume `composeRunOperatorError`), not new per-entry-point logic.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — update the `invocation_error` message-projection sentence (§ Operator error on list and wait): an echoed `error`-kind failure now composes an attributed message from `failureKind` and `bindingAttempts` instead of omitting `message`.
- `v2/docs/operator-runbook.md` — § Review-role timeouts and stalls, "Prompt-echoed stderr" paragraph: `invocation_error` now names the failure class and attempted bindings instead of falling back to the bare generic reason.
- `v2/docs/v1-behaviors.md` — update the existing echoed-input entry (`runStep classifies a terminal invocation_failure's settling-binding stderr as echoed input...`) to record the new composed message in place of "falls back to the generic invocation_error reason"; add `v2/src/daemon/run-operator-error.ts` to its sources.
