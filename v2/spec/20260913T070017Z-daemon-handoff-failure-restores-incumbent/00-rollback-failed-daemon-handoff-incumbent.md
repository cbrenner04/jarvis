# Roll back a failed daemon handoff — incumbent ownership

## Problem

The incumbent irreversibly enters retiring state and releases the stable public address when it accepts `changeover`. If the spawned successor then dies, fails to bind, or times out before readiness, no daemon reclaims the public address: the incumbent remains reachable only at its private endpoint and rejects new work while its admitted work drains. Worse, if no successor signal ever arrives — a SIGKILL, a crash before any request — the incumbent has no way to notice and is stuck retiring forever.

## Behavior

Treat the interval from accepted changeover through successor readiness as a handoff transaction the incumbent owns. The incumbent issues an opaque handoff identity in its `changeover` reply; a commit or rollback request is honored only when its identity matches the active transaction. Rollback reclaims the stable public address: the incumbent rebinds it before reopening admission. If rollback arrives while the incumbent's own release of that listener is still in flight, it waits for the release to finish before rebinding. If the rebind itself fails, the incumbent stays retiring, keeps draining, and surfaces the failure — it never admits work at only the private endpoint. Commit finalizes the handoff: the successor keeps the stable address, the incumbent stays retiring, and a late or duplicate signal cannot reverse it. Repeated matching commit or rollback requests are idempotent. An idle incumbent (no active runs) is kept alive while its handoff is pending, bounded by a liveness fallback: if no commit or rollback request arrives before the deadline, the incumbent probes the stable public address itself — a live daemon answering there means commit, otherwise rollback.

## Decisions

- Issue the handoff identity in the incumbent's `changeover` reply; reject a commit or rollback request carrying an unknown or stale identity and leave ownership unchanged; rules out a stale signal from an earlier attempt mutating a later generation's ownership.
- Keep an incumbent alive while its handoff is pending even with zero active runs, bounded by the liveness fallback rather than indefinitely; rules out drain-exit racing the successor's startup verdict, and rules out an incumbent stuck forever when no signal ever arrives.
- On liveness-fallback expiry, probe the stable public address and commit if a live daemon answers there, else roll back; rules out guessing dead-versus-slow from the incumbent's side alone.
- Rebind the stable public listener before reopening admission; rules out the private endpoint admitting work while no daemon owns the stable address.
- If rollback arrives while the incumbent's own listener release is still in flight, wait for that release to finish before rebinding; rules out the rebind racing the incumbent's in-progress release of the same address.
- If rebind fails during rollback, stay retiring and draining and surface the failure rather than admitting on the private endpoint only; rules out silently exposing an unaddressable admission point.
- Restore the incumbent's existing runtime, admission state, and active work registry; rules out restarting the process or redispatching admitted work.
- Commit ownership after the successor answers at the stable public address and before startup reports success; rules out a late rollback reopening a successfully handed-off incumbent.
- Make matching commit and rollback requests idempotent; rules out duplicate failure delivery creating another listener or changing an already-settled transaction.

## Task checklist

- [ ] Add correlated pending, committed, and rolled-back handoff transitions to the incumbent runtime, including identity issuance in the `changeover` reply and identity-mismatch rejection.
- [ ] Add drain-exit gating for a pending handoff and bind-before-admit listener restoration on rollback.
- [ ] Add rollback-vs-in-progress-release ordering (wait for the incumbent's own release before rebind) and rebind-failure handling (stay retiring, surface the failure).
- [ ] Add the incumbent-side liveness/deadline fallback that resolves an unanswered pending handoff by probing the stable public address.
- [ ] Add focused lifecycle and real-socket regression coverage in `daemon-changeover.sandbox-unrunnable.test.ts` sending commit and rollback requests straight to the private endpoint: rollback, admitted-work continuity, successful commit, duplicate signals, identity mismatch, idle-incumbent survival, and the liveness fallback.
- [ ] Align the durable daemon-host documentation with the incumbent-owned transaction states and rollback ordering.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` gains a regression that fails against the pre-fix one-way retiring state by sending a rollback request directly to the incumbent's private endpoint after cutoff, then proves the incumbent again answers and accepts new work at the stable public address.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves work admitted by the incumbent before the failed handoff remains live throughout rollback and reaches its normal outcome.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves a commit request keeps the stable public listener with the successor while the incumbent remains non-admitting at its private endpoint, and a late rollback sent after commit does not reopen it.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves repeated matching rollback requests leave exactly one admitting public listener.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves a commit or rollback request carrying an unknown or stale handoff identity is rejected and leaves ownership unchanged.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves an idle incumbent with no active runs survives while its handoff is pending instead of exiting on drain-exit.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` proves that when no commit or rollback request arrives before the liveness-fallback deadline, the incumbent rolls back after finding no live daemon at the stable public address; it fails against the pre-fix code, which never resolves an unanswered pending handoff.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Verification

- `bun run typecheck`, `bun run test:v2`, and the added changeover integration file pass. `bun run test:integration:v2` remains red only in two pre-existing `generation-drain-and-exit.sandbox-unrunnable.test.ts` cases; the same failures reproduce at merge-base `980a086afc89823d989484fd4f4a41238c39c3e9`.

## Documentation updates

- `v2/docs/daemon-host.md` — define the incumbent-owned pending/committed/rolled-back handoff states, identity issuance and mismatch rejection, bind-before-admit ordering, rollback-vs-release-in-progress ordering, rebind-failure handling, and the liveness-fallback deadline.
- `v2/docs/v1-behaviors.md` — record the rollback-safe v2 generation-handoff behavior.
