---
name: terminal-invocation-failure-persists-stderr
---

# Terminal invocation_failure persists final-attempt stderr on InvocationFailureDetail

## Prerequisites

## Module-boundary surface

- Execution loop: write-step terminal `invocation_failure` settlement.

## Problem

When a binding chain exhausts without advancing, terminal `invocation_failure` settlement drops the final attempt's stderr — telemetry keeps only `exit_reason: exit_code:N` and `InvocationFailureDetail.message` stays unset, making failures undiagnosable from durable records (#3106).

## Decision ledger

- Populate `InvocationFailureDetail.message` with the last 2048 characters of the final attempt's stderr at terminal `invocation_failure` settlement; rules out a new persistence surface.
- Leave `message` unset when stderr is empty; rules out fabricating placeholder text.

## Acceptance criteria

- [ ] A write-path test proves a terminal `invocation_failure` whose final attempt carries stderr persists a bounded tail on the committed `InvocationFailureDetail.message`; it fails against the pre-fix settlement path.
- [ ] The same test proves empty stderr leaves `message` unset.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — settlement-only persistence on `InvocationFailureDetail.message`; operator-facing projection docs live in invocation-failure-stderr-in-run-errors.
