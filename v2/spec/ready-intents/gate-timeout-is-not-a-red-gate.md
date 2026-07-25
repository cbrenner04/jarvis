---
name: gate-timeout-is-not-a-red-gate
---

# A ready-gate timeout kill reaches the implement run as retryable infrastructure failure

## Problem

When `bun run ready` is killed by its deadline it exits `124` (`TIMEOUT_EXIT_CODE`). The implement
run cannot distinguish that from a failing test: `publishWithReadyRepair`
(`v2/src/execution/write-loop.ts`) treats any `ReadyGateError` as a red gate, records
`ready_gate_repair`, and hands a phantom red gate to the repair agent, which then edits code that
was never broken.

Observed 2026-07-25 on PR #2121: the gate timed out at 600s, the run logged
`{"kind":"ready_gate_repair","attempt":1,"gateExitCode":1}` — the `124` laundered to `1` on the way
up — then attempt 2, burning two ~12-minute repair iterations. The same gate re-run by hand at the
same commit passed green with 0 failures.

`isGenuineTestFailure` in `scripts/ready.ts` already distinguishes a timeout kill for the *retry*
decision; nothing carries that distinction to the caller.

## Decisions

- A timeout kill (`124`) reaches the implement run as a retryable infrastructure failure: the repair path is not entered and no agent iteration is spent. Rules out the observed `gateExitCode: 1` laundering, which costs two full repair iterations per occurrence.
- A genuinely failing gate still enters the repair path unchanged; the discrimination must hold in both directions.
- Out of scope: the per-step budget model, and the underlying `daemon-lifecycle` real-clock flake.

## Acceptance criteria

- [ ] A test drives a ready gate whose test step is killed by the deadline and asserts the implement run records a retryable infrastructure outcome — not `ready_gate_repair`, and with no agent iteration consumed; it fails against the pre-fix code, which reports `gateExitCode: 1`.
- [ ] A test asserts a genuinely failing test step still enters the repair path; inverting the timeout guard fails one of the two tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `124` gate exit is a budget kill, not a red gate; how to tell them apart, and that a `shared/**` diff pulls in all three test slices.

## Prerequisites

- The ready gate exits `124` on a deadline kill, distinct from a test-failure exit code.
