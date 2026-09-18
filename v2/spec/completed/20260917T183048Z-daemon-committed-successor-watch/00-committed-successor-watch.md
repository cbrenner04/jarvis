# Committed handoff keeps watching the successor and rebinds when it dies

`createHandoffHandlers` (`v2/src/daemon/daemon.ts`) clears the fallback timer on `commit` and leaves the transaction terminal: nothing in the outgoing generation observes the successor afterward. A successor that dies after commit leaves the public address unbound, while the outgoing generation is still alive with active runs and no longer admitting.

This subspec makes the committed state observed rather than terminal: the outgoing generation keeps probing the public address, and rebinds + reopens admission when nobody answers.

## Decisions

- The watch arms inside the shared `commit()` helper, so it covers both routes that leave a transaction `committed`: the `handoff_commit` RPC and the fallback timer's `commit` verdict (`resolveFallback`) — rules out arming only on the RPC, which would skip the watch for a handoff the fallback timer settled.
- The watch probes the public address on the existing `fallbackMs` cadence via `probePublicServer`; successor process liveness is not tracked separately — rules out passing a successor pid through this seam, which does not have one, and which would miss a live successor that stopped answering.
- A failed probe drives the same rebind path as `rollback` (`bindPublicServer`, then unconditional `setAdmitting`), moving the transaction to `rolled_back` — rules out a distinct recovery path duplicating the reclaim-unanswered-socket logic.
- The rebind reopens admission unconditionally, not gated by `wasSuperseded()` — rules out reusing the rollback guard: the ordinary self-handoff already sets `superseded = true` when the successor's own startup calls `supersede` on this generation's socket (`supersedePeerDaemon`, `daemon-peer-socket.ts`), so `!wasSuperseded()` is false in exactly the shape this subspec exists to recover, and would leave a correctly-rebound generation never admitting. The guard stays as-is for `rollback`'s own pre-commit callers.
- `bindPublicServer`'s existing reclaim (`removeUnansweredSocketPath`) is reused unchanged for the rebind, with no added confirmation round — rules out both a distinct reclaim path and a debounce. `removeUnansweredSocketPath` already fails safe toward "live": a successor with an open listener is classified `live` by a raw OS-level connect accept (or a probe timeout, both fail-safe), regardless of how slowly it answers `health` at the application level, and only that classification, not the watch's own RPC probe, gates removal. A successor slow enough to fail the watch's `probePublicServer` check but still listening is therefore never displaced.
- After a rebind, the watch stops and the handoff is not re-attempted; the next autonomous self-handoff digest sample decides whether to try again — rules out an immediate respawn loop against a successor that just died.
- A rebind whose `bindPublicServer` throws reschedules the watch on the same cadence — rules out leaving the address unbound after one transient bind failure.
- The rebind logs a handoff-settlement line naming its own trigger, distinct from `handoff_fallback` — rules out reusing the fallback trigger, which would make operator logs unable to distinguish a successor that never committed from one that died after committing.
- `close()` clears the watch timer alongside the fallback timer — rules out a timer outliving the handlers.
- Recovery is best-effort, bounded by `shouldShutdownNow`: an idle outgoing generation with no active runs still exits on the drain-exit loop once retiring, same as today, because `handoffPending` (from `isPending()`) is false once committed — the watch never gets to rebind an already-exited generation. This subspec does not touch `shouldShutdownNow`; widening drain-exit to also wait on the committed watch is a distinct, independently testable surface for a separate intent — rules out folding it in here, which would absorb a second module's existing tests and guard into an unrelated change.
- Deferred to first consumer: no RPC or CLI surfaces the watch state — pin when a caller needs it.

## Task checklist

- [ ] Arm the watch inside `commit()` and clear it on `close()`.
- [ ] Rebind, reopen admission unconditionally, mark `rolled_back`, and log on a failed probe; reschedule on bind failure.
- [ ] Extract the watch decision as a pure exported predicate and test both directions without a real-timer wait.
- [ ] Update `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [x] A daemon test commits a handoff via the ordinary self-handoff shape (the successor calls `supersede` on the predecessor, matching `supersedePeerDaemon`'s production wiring, so `wasSuperseded()` reads true), then makes the public address stop answering, and asserts the outgoing generation rebinds, answers again, and reopens admission (`start`/`resume` accepted) within the bounded cadence; it fails against the pre-fix code.
- [x] A test kills a real successor process (not just a stubbed non-answering probe) after commit and asserts the outgoing generation reclaims the leftover socket and rebinds; it fails against the pre-fix code.
- [x] A test injects a `startupDeps.startIpcServer` failure on the rebind attempt and asserts the watch retries on the next tick and eventually rebinds; it fails against the pre-fix code.
- [x] A test asserts the rebind writes a handoff-settlement daemon-log line naming a trigger distinct from `handoff_commit`, `handoff_rollback`, and `handoff_fallback`; it fails against the pre-fix code.
- [x] A test asserts a successor that still holds an open listener but answers the watch's `health` RPC too slowly is never displaced, asserting positively that the watch ran: the tick observed the address unanswered, attempted the rebind, had its bind refused with the address in use, and `removeUnansweredSocketPath` classified the still-listening successor `live` (per `v2/src/ipc/server.test.ts`'s "refuses to unlink a live peer socket" guarantee) — leaving the socket in place and rescheduling the watch without marking the transaction `rolled_back` or logging a rebind trigger. The assertion is on the observed tick, not on the absence of an effect, so it cannot pass against pre-fix code that never ticks.
- [x] A test asserts `close()` stops the watch: no further probe, rebind, or log line occurs on the next tick after `close()` runs.
- [x] The committed-handoff watch tick's rebind decision is a pure exported predicate in `v2/src/daemon/daemon.ts`, tested in both directions without a real-timer wait. Reuse or extend the existing `fallbackVerdict` / `isHandoffStillPending` exports rather than adding a near-duplicate of either.
- [x] `v2/src/daemon/daemon-retire-trigger-logging.test.ts` stays green (existing settlement and drain-exit logging unchanged).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/daemon-host.md` § Handoff changeover at the public address — the committed state is watched, not terminal: probe cadence, unconditional admission reopen on rebind, reuse of the existing unanswered-socket reclaim, no re-attempt until the next digest sample, and that the watch only helps while the outgoing generation is still alive (an idle retiring generation with no active runs still exits via drain-exit before it could rebind).
- [ ] `v2/docs/operator-runbook.md` § Daemon lifecycle — what the operator sees when a committed successor dies while the outgoing generation still has active runs: the daemon-log line, the address coming back on its own within roughly one `fallbackMs` interval (default ~13s, so worst case one missed probe plus the next tick), `daemon start` not required in that case; and that an idle outgoing generation with no active runs has already exited and still needs a manual `daemon start`.
- [ ] `v2/docs/v1-behaviors.md` — record the changed post-commit handoff behavior.
