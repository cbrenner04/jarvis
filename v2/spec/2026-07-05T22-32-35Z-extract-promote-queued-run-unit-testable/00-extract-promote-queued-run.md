# Extract promoteQueuedRun into a standalone unit-testable function

`promoteQueuedRun`'s FIFO-with-skip promotion (`v2/src/daemon/daemon.ts:489`)
is a closure inside `createRunControlHandlers`, reachable for testing only via
a real IPC socket round trip through `daemon-queue-promotion.test.ts`.

## Decisions

- Extract `promoteQueuedRun` to a standalone exported function in
  `v2/src/daemon/daemon.ts` (or a co-located module), taking the state store,
  the `WorktreeOwnershipRegistry`, the memory-headroom check, and the
  settle-delay suppression state as explicit parameters — no closure capture
  over `createRunControlHandlers`' locals.
- The actual write-loop dispatch (`spawnWriteLoop`, which owns
  `activeRuns`/executor wiring) stays a caller-supplied callback parameter —
  it is infrastructure the extracted function should not own.
- `createRunControlHandlers` calls the extracted function with its existing
  `store`, `_registry`, `checkMemoryHeadroom`, and `settleDelayMs`; no
  behavior change.

## Task checklist

- [ ] Extract `promoteQueuedRun` per the decisions above.
- [ ] Convert the pure promotion-ordering tests in
      `v2/src/daemon/daemon-queue-promotion.test.ts` (FIFO-with-skip order,
      claimed-key skip, memory-headroom gate, settle-delay suppression) to
      call the extracted function directly, without an IPC socket.
- [ ] Keep any genuine RPC-wiring test in that file (e.g. the immediate
      recheck triggered through the `start` RPC) on a real socket.
- [ ] Update `v2/docs/daemon-host.md` per Documentation updates below.

## Documentation updates

- `v2/docs/daemon-host.md` `#promotion-of-queued-runs`: note the promotion
  logic is a standalone exported function, with daemon wiring calling it.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-queue-promotion.test.ts` stays green, with its
      promotion-ordering cases calling the extracted function directly
      (behavior unchanged by the extraction).
- [ ] `bun run test:v2` passes.
- [ ] `v2/docs/daemon-host.md` documents the extraction at
      `#promotion-of-queued-runs`.
