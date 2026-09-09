# 00 - Handshake waits under the suite timeout

## Problem

`waitForLockHeld(subprocess, timeoutMs = 10_000)` rejects with `lock holder did not report jarvis-lock-held within 10000ms` when Bun startup plus module load plus the first transaction takes longer than 10s on a loaded machine. The assertions under test (a second writer commits without `database is locked`; the observed wait reflects the holder's hold time) never depend on that latency.

## Decisions

- The handshake helper moves to `v2/src/testing/subprocess-marker.ts` as `waitForStdoutMarker(subprocess, marker)` with no private wall clock; it resolves when the marker arrives, rejects only when the subprocess exits or closes stdout without printing it (message names the exit and that the marker never arrived), and otherwise leaves bounding to the file's own test timeout; rules out raising 10s to a larger constant a busier machine still crosses.
- The WAL test keeps its assertions unchanged and calls the shared helper; rules out treating handshake latency as part of the contract.
- The broader base-ref-probe-under-load defect stays with the `coscheduled-test-pair-strands-runs-terminally` seed; rules out conflating the two.

## Tasks

- Add `v2/src/testing/subprocess-marker.ts` and `subprocess-marker.test.ts`.
- Replace `waitForLockHeld` in `state-store-wal-concurrency.test.ts` with the helper.

## Acceptance criteria

- [x] `v2/src/testing/subprocess-marker.test.ts` test `waits past the former ten-second budget for a late marker` proves a child that prints the marker after more than 10s (simulated with a fake stdout stream and fake timers, not a real sleep) still resolves; it fails against the former `timeoutMs = 10_000` rejection.
- [x] `v2/src/testing/subprocess-marker.test.ts` test `rejects when the child exits without the marker` proves a child that closes stdout without printing rejects with a message naming the missing marker and the exit.
- [x] `v2/src/persistence/state-store-wal-concurrency.test.ts` assertions are unchanged and green; `bun run test:v2` passes three consecutive times.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — a subprocess startup handshake carries no private wall clock; the suite runs files concurrently, so such deadlines measure machine load; use `waitForStdoutMarker`.
- `v2/docs/operator-runbook.md` — § Concurrency: retire the WAL test as a known load-sensitive `ready_gate_out_of_scope` trigger once this lands.
