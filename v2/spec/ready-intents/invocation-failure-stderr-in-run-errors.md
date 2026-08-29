---
name: invocation-failure-stderr-in-run-errors
---

# run list and run wait surface invocation_failure stderr in error.message

## Prerequisites

- Terminal `invocation_failure` settlement persists a bounded stderr tail on `InvocationFailureDetail.message` when the final attempt carried stderr.

## Module-boundary surface

- Daemon: `run list` / `run wait` operator-error projection.

## Problem

`composeRunOperatorError` omits `InvocationFailureDetail.message` from `error.message` on binding-chain `invocation_failure` rows, so operators cannot read the agent refusal from `jarvis run list` or `jarvis run wait` even when durable attempt rows carry it.

## Decision ledger

- Project persisted `InvocationFailureDetail.message` onto `RunOperatorError.message` for binding-chain `invocation_failure` outcomes; rules out requiring `jarvis run log` as the only copy of terminal stderr.
- Omit `message` when the detail omits it; rules out synthesizing text at projection time.

## Acceptance criteria

- [ ] `v2/src/daemon/run-operator-error.test.ts` proves `invocation_failure` with a populated detail `message` surfaces it on `composeRunOperatorError(...).message`; it fails against the pre-fix mapper.
- [ ] A write-path test proves terminal `invocation_failure` stderr is visible via `run list` / `run wait` `error.message` projection; it fails without both settlement and projection fixes.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `invocation_error` rows may carry the final binding's stderr in `error.message`.
