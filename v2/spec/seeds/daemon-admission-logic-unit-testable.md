# Extract daemon admission/promotion logic to unit-testable functions

`createRunControlHandlers` in `v2/src/daemon/daemon.ts` defines admission,
claim-checking, and FIFO promotion (`promoteQueuedRun`, `startHandler`, etc.)
as closures inside one factory. None of that logic is exported standalone, so
testing it requires a real Unix domain socket server + IPC client round trip
even though the logic itself is pure control flow (ordering, predicate
checks) with no inherent need for a live transport.

## Why this matters

- 8 v2 test files already spin up real `startIpcServer`/`connectIpcClient`
  pairs; the memory-watermark-admission-and-queued-status subspec
  (2026-07-05) added another (`daemon-queue-promotion.test.ts`, 7 tests) to
  exercise pure FIFO/claim logic this way.
- CI's `test:v2` step runs with far less parallelism (4 workers on the GH
  Actions runner) than local dev (18 workers), and wraps the whole run in a
  fixed 300s (`AGENT_MODE_TIMEOUT_MS`) kill switch. As real-socket tests
  accumulate, that fixed budget gets tighter — this subspec's PR (#1068) hit
  a timeout-kill in CI (`Test (v2)`) that reran clean, consistent with
  capacity/contention rather than a real hang, but the trend is the wrong
  direction as v2 grows.
- Reasoning about real async socket state machines is also why the
  implementing agent introduced a real bug: a test tried to reach an
  unreachable state (`start` rejects an already-claimed key before ever
  queuing behind it) by driving it through two real `start` RPC calls — a
  mistake much less likely with a plain function call and direct state
  inspection.

## Decision

Extract admission/claim/promotion logic (the pieces currently only reachable
as closures inside `createRunControlHandlers`) into standalone exported
functions taking explicit dependencies (store, registry, memory-check
function) as parameters, so they're unit-testable by direct call + return
value / state inspection, no socket involved. Keep a small number of true
end-to-end IPC tests to prove the RPC wiring itself, not the logic.

## Scope

- `v2/src/daemon/daemon.ts`: extraction only, no behavior change.
- Candidates: `promoteQueuedRun`, the `worktree_claimed` claim check used by
  `start`/`resume`/`revise`, `hasMemoryHeadroom` call site wiring.
- Existing real-socket tests that only exercise this logic (not RPC wiring
  itself) should convert to direct unit tests against the extracted
  functions; genuine wiring/transport tests stay as-is.

## Documentation updates

- `v2/docs/daemon-host.md`: note the admission/promotion logic lives in
  standalone exported functions, with IPC handlers as thin wiring over them.
