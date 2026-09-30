# Fallback rollback defers when a live successor holds the public address

`resolveFallback` rolls back when the public probe reads not-live, then reschedules on `handoff_rollback_failed` (`v2/src/daemon/daemon.ts`). If the successor still holds an open listener (slow readiness, or bind racing rollback), `bindPublicServer` can fail with `EADDRINUSE` or `removeUnansweredSocketPath` classifying the peer live while the fallback keeps scheduling competing rollback attempts instead of waiting for that successor to commit or roll back.

Depends on [00-rollback-clears-handoff-origin-supersede.md](00-rollback-clears-handoff-origin-supersede.md) so a fallback rollback that eventually rebinds also reopens admission.

## Decisions

- When fallback rollback cannot rebind because a live successor still owns the stable public address, defer further rollback attempts until the public probe shows commit (successor keeps the address) or not-live (then reclaim) — rules out `scheduleFallback` loops that race the same live successor's bind/commit.
- A transient bind failure with no live peer (e.g. injected throw before reclaim succeeds) still reschedules on the existing fallback cadence — rules out treating every `handoff_rollback_failed` as deferral.
- Deferral mechanism: when `resolveFallback`'s probe reads live, or rollback fails with `EADDRINUSE`/live-peer classification, keep the transaction pending and schedule one re-probe via `scheduleFallback` instead of attempting rollback; roll back only when the re-probe reads not-live — rules out a separate watch or new transaction state, and rules out rollback attempts while the successor is observed live.
- Fallback regressions use injected fakes (`probePublicServer`, `bindPublicServer`) and an injected/fake clock for `scheduleFallback` — rules out sandbox sockets and real-timer waits.

## Task checklist

- [ ] Teach `resolveFallback` / rollback error handling to distinguish live-successor bind refusal from retriable reclaim failures.
- [ ] Add focused fake-driven fallback regressions (injected `probePublicServer`/`bindPublicServer`, fake clock): EADDRINUSE-then-success rebind; live successor holds the public address; assert rollback defers without rescheduling a competing rebind until the successor settles commit or rollback.
- [ ] Align `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] A focused fake-driven fallback regression (fake `bindPublicServer`, fake clock) asserts first `bindPublicServer` rejects `EADDRINUSE`, a rescheduled attempt succeeds, admission reopens, and the transaction is `rolled_back`; it fails against the pre-fix code.
- [ ] Fallback regressions use injected fakes and a fake clock only — no sandbox sockets, no real timers.
- [ ] A focused fake-driven fallback regression with a live successor holding the public address asserts rollback defers without rescheduling a competing rebind until that successor settles commit or rollback; it fails against the pre-fix code.
- [ ] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` "a fallback rollback that fails once still resolves the pending handoff once rebind succeeds" stays green (transient reclaim failure without a live peer still reschedules).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/daemon-host.md` § Handoff changeover — reconcile the existing paragraph that a failed fallback rollback reschedules until rebind or a live successor is found with deferral: while a live successor still holds the stable public address, fallback rollback does not schedule competing rebind attempts and waits for commit or not-live before reclaim; transient failures with no live peer still reschedule on the existing cadence.
- [ ] `v2/docs/v1-behaviors.md` — extend the `[v2-only]` handoff-transaction bullet with fallback deferral when a live successor holds the public address.
