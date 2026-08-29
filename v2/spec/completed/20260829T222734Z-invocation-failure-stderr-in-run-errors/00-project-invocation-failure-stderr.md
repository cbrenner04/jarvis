# Project invocation failure stderr

## Problem

Binding-chain `invocation_failure` attempt rows can persist the final binding's bounded stderr tail, but daemon `run list` and `run wait` operator errors omit it.

## Decision ledger

- Project persisted `InvocationFailureDetail.message` verbatim onto `RunOperatorError.message` for binding-chain `invocation_failure`; rules out forcing operators to use `jarvis run log` for the only copy.
- Omit `RunOperatorError.message` when `InvocationFailureDetail.message` is absent; rules out projection-time fallback text.

## Implementation

- Extend the daemon's attempt-detail operator-error projection without changing reason, retryability, next action, persistence, or CLI exit-code semantics.
- Add focused mapper and daemon list/wait regression coverage.
- Align the operator runbook and v1 behavior catalog in their existing sections.

## Acceptance criteria

- [x] `v2/src/daemon/run-operator-error.test.ts` proves a binding-chain `invocation_failure` with populated `InvocationFailureDetail.message` returns that value from `composeRunOperatorError(...).message`, while absent detail message remains omitted; the populated case fails against the pre-fix mapper.
- [x] `v2/src/daemon/daemon-wait-run-completion.test.ts` proves a terminal run whose attempt row persists `InvocationFailureDetail.message` exposes the same value at `error.message` on daemon `wait`; it fails against the pre-fix mapper.
- [x] `v2/docs/operator-runbook.md` documents that `invocation_error` operator errors may include the final binding stderr tail in `error.message`.
- [x] `v2/docs/v1-behaviors.md` records the v2 additive `error.message` projection.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the optional final-binding stderr tail on `invocation_error` operator errors.
- `v2/docs/v1-behaviors.md` — record the v2 additive list/wait projection and v1 non-equivalence.
