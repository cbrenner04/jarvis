# Stable-digest sampling tick self-heal wiring

Depends on [00-retiring-sole-owner-self-heal-predicate.md](00-retiring-sole-owner-self-heal-predicate.md).

When the predicate from 00 matches, the incumbent must clear `retiring` on the same cadence as autonomous digest sampling, before the existing `isRetiring()` early return would skip `onTick()`, so backoff retry and new work can proceed without `jarvis daemon start`.

## Decisions

- On each self-handoff sampling interval tick, evaluate the 00 predicate first; when true call the same admission reopen path rollback uses (`setAdmitting` / `runControlContext.retiring = false`) — rules out a second ad-hoc flag and rules out running self-heal inside `startStableDigestTrigger`'s `tick` (the retiring skip lives in `scheduleSampling` in `daemon.ts`, outside the controller).
- Keep the existing `if (isRetiring()) return` immediately after self-heal so a generation still retiring after a failed self-heal attempt continues to skip digest triggering until self-heal succeeds — rules out removing the admission-cut guard.
- Self-heal does not run when `handoffHandlers.isPending()` or when `probePublicServer` reports a live successor — enforced via the 00 predicate inputs, not duplicate inline checks — rules out divergent guard logic between predicate and wiring.
- Add `v2/src/daemon/daemon-retiring-sole-self-heal.test.ts` using `startDaemonRuntime` startup deps (fake IPC bind, injectable sampling loop or interval seam, controllable retiring / pending / probe / rollback-block fakes) — rules out sandbox-only coverage for the interval ordering fix.

## Task checklist

- [ ] Wire predicate evaluation and admission reopen ahead of the retiring skip in the production `scheduleSampling` callback.
- [ ] Add focused regressions: matching incumbent reopens and admits `start`; pending handoff, live public successor, `publicBound === false`, and `blocksRollbackReopen === true` each leave admission closed.
- [ ] Update inline comment at the self-handoff sampling block to describe self-heal-before-skip ordering.
- [ ] Align operator docs per Documentation updates.

## Acceptance criteria

- [ ] `daemon-retiring-sole-self-heal.test.ts` leaves a retiring incumbent in the sole-owner stranded shape (public bound, no pending handoff, probe not live, rollback not blocked), fires one self-handoff sampling tick through production wiring, and asserts a subsequent `start` is admitted; it fails against the pre-fix code reachable on main where every tick returns early on `isRetiring()` with no self-heal path.
- [ ] The same test file asserts self-heal does not run while a handoff is pending and does not run while the public liveness probe reports a live successor (constructible on main via fakes without requiring a real successor process).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/daemon-host.md` § Autonomous self-handoff — retiring sole-owner self-heal on the stable-digest sampling tick reopens admission when no pending handoff and no live public successor; sampling and backoff retry proceed on later ticks.
- [ ] `v2/docs/operator-runbook.md` § Daemon lifecycle — stranded `daemon_superseded` on a sole daemon after failed self-handoff may self-recover on the sampling cadence when self-heal applies; `jarvis daemon start` remains the manual fallback.
- [ ] `v2/docs/v1-behaviors.md` — `[v2-only]` autonomous self-handoff / handoff bullets: note sole-owner self-heal on the stable-digest sampling tick.
