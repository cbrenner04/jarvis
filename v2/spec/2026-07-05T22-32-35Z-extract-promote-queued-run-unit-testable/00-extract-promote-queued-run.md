# Extract promoteQueuedRun into a standalone unit-testable function

`promoteQueuedRun`'s FIFO-with-skip promotion (`v2/src/daemon/daemon.ts:489`)
is a closure inside `createRunControlHandlers`, reachable for testing only via
a real IPC socket round trip through `daemon-queue-promotion.test.ts`.

## Decisions

- Extract `promoteQueuedRun` to a standalone exported function in
  `v2/src/daemon/daemon.ts` (same file — avoids new import surface for tests
  and docs), taking the state store, the `WorktreeOwnershipRegistry`, the
  memory-headroom check, the settle-delay duration, and the `spawnWriteLoop`
  callback as explicit parameters — no closure capture over
  `createRunControlHandlers`' locals.
- Settle-delay state (`promotionsSuppressedUntil`) is mutated by each
  promotion and must be readable/writable across calls: pass it as a mutable
  ref object, e.g. `settleState: { suppressedUntil: number }`, that the
  extracted function reads to decide suppression and writes after a
  promotion. `createRunControlHandlers` owns one `settleState` object
  (replacing today's `let promotionsSuppressedUntil`) and passes it on every
  call.
- The actual write-loop dispatch (`spawnWriteLoop`, which owns
  `activeRuns`/executor wiring) stays a caller-supplied callback parameter —
  it is infrastructure the extracted function should not own.
- Resolving the `spawnWriteLoop` ↔ `promoteQueuedRun` circularity (today
  `spawnWriteLoop`'s completion `finally` calls `promoteQueuedRun`, which can
  itself call `spawnWriteLoop`): `createRunControlHandlers` defines
  `spawnWriteLoop` first, then defines a bound `promoteQueuedRun = (bypass) =>
  promoteQueuedRunImpl({ store, registry: _registry, checkMemoryHeadroom,
  settleDelayMs, settleState, spawnWriteLoop }, bypass)` after it, exactly as
  the current `const`/closure ordering already permits (both are defined
  before either is invoked, since invocation happens inside async callbacks).
  `spawnWriteLoop`'s `finally` block closes over this same bound
  `promoteQueuedRun`, unchanged in shape from today.
- `createRunControlHandlers` calls the bound `promoteQueuedRun` at its
  existing three call sites (`spawnWriteLoop`'s `finally`, `startHandler`'s
  immediate recheck, `startHandler`'s post-admit check); no behavior change.

## Task checklist

- [ ] Extract `promoteQueuedRun` per the decisions above.
- [ ] Convert these `v2/src/daemon/daemon-queue-promotion.test.ts` cases to
      call the extracted function directly, without an IPC socket:
  - [ ] "promotes the oldest queued run before a younger one once memory
        clears and the settle delay has elapsed" (FIFO order) — mechanical:
        seed queued rows via `store.createRun`, call the extracted function.
  - [ ] "a queued run stays queued while memory stays below the watermark"
        (memory-headroom gate) — mechanical, same conversion.
  - [ ] "a queued run whose key is claimed by a live run is skipped in favor
        of the next-oldest eligible queued run" (claimed-key skip) — **not**
        mechanical: today's test obtains the live claim via a real
        `spawnWriteLoop` round trip over the socket; converting requires
        manually seeding the claim with `registry.claim(key, { runId,
        worktreePath })` before calling the extracted function.
- [ ] Leave these cases on a real socket (genuine RPC/handler wiring, not
      promotion-ordering logic):
  - [ ] "promoting one queued run does not touch an already-running run when
        headroom later reports insufficient" — exercises `startHandler`
        admission plus an already-running run's status staying untouched by
        headroom checks, not the promotion loop itself.
  - [ ] "a start that queues because memory is briefly tight is promoted
        immediately once memory has already recovered" — exercises
        `startHandler`'s `bypassSettleDelay` recheck path.
  - [ ] "a run reaching a paused status frees its key for promotion of an
        eligible queued run" — exercises pause-status handling releasing the
        registry claim, not promotion ordering.
  - [ ] "list reports a promoted run as in-progress and live" — exercises the
        `list` RPC handler's `isLive` computation.
- [ ] No existing test asserts that a promotion was withheld because it fell
      inside the settle-delay suppression window (the 100_000ms-delay case
      above only proves an unrelated running run is undisturbed). Add one new
      unit test on the extracted function: two eligible queued runs, first
      promotion sets `settleState.suppressedUntil` in the future, a second
      call before that deadline elapses promotes nothing.
- [ ] Update `v2/docs/daemon-host.md` per Documentation updates below.

## Documentation updates

- `v2/docs/daemon-host.md` `#promotion-of-queued-runs`: note the promotion
  logic is a standalone exported function, with daemon wiring calling it.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-queue-promotion.test.ts` stays green: the four
      promotion-ordering cases listed above call the extracted function
      directly (behavior unchanged by the extraction) and the four RPC-wiring
      cases stay on a real socket.
- [ ] A new unit test on the extracted function proves a promotion is
      withheld while `settleState.suppressedUntil` is in the future.
- [ ] `bun run test:v2` passes.
- [ ] `v2/docs/daemon-host.md` documents the extraction at
      `#promotion-of-queued-runs`.
