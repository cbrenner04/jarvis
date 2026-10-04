# Persist final-attempt stderr

## Problem

When a write-step binding chain stops without advancing, terminal `invocation_failure` settlement persists only the exit classification and binding-attempt summary. The final attempt's stderr is discarded, leaving the committed `InvocationFailureDetail.message` unset and the durable failure undiagnosable.

## Decision ledger

- Persist the last 2048 JavaScript UTF-16 code units of only the final binding attempt's stderr in `InvocationFailureDetail.message`; rules out storing unbounded stderr, concatenating attempts, or adding a persistence surface.
- Persist stderr verbatim, including whitespace-only content, and omit `message` only when the final stderr is truly empty; sanitization and redaction are out of scope.

## Tasks

- [ ] Extend write-loop terminal `invocation_failure` detail assembly to copy the bounded final-attempt stderr tail into the existing optional `message` field.
- [ ] Add focused write-loop persistence coverage for multiple attempts with distinct stderr, a final stderr longer than 2048 UTF-16 code units, empty stderr, and whitespace-only stderr.
- [ ] Document terminal binding-chain stderr persistence in `v2/docs/v1-behaviors.md` and optional `message` in the binding-chain `invocation_failure` JSON fields in `v2/docs/write-behavior.md`.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` proves a terminal binding-chain `invocation_failure` with multiple attempts carrying distinguishable stderr commits exactly the final attempt's last 2048 JavaScript UTF-16 code units to `InvocationFailureDetail.message`, excluding earlier-attempt stderr; it fails against the pre-fix settlement path.
- [x] The same `v2/src/execution/write-loop.test.ts` regression proves truly empty final-attempt stderr leaves the committed `InvocationFailureDetail.message` unset and whitespace-only stderr is persisted verbatim.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` with terminal binding-chain stderr persistence and `v2/docs/write-behavior.md` with optional `InvocationFailureDetail.message`; operator-facing projection remains owned by `invocation-failure-stderr-in-run-errors`.
