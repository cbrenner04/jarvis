# Stable-digest sampling tick self-heal wiring

Depends on [00-retiring-sole-owner-self-heal-predicate.md](00-retiring-sole-owner-self-heal-predicate.md).

When the predicate from 00 matches, the incumbent must clear `retiring` on the same cadence as autonomous digest sampling, before the existing `isRetiring()` early return would skip `onTick()`, so backoff retry and new work can proceed without `jarvis daemon start`.

## Decisions

- On each self-handoff sampling interval tick, evaluate the 00 predicate first; when true call the same admission reopen path rollback uses (`setAdmitting` / `runControlContext.retiring = false`) — rules out a second ad-hoc flag and rules out running self-heal inside `startStableDigestTrigger`'s `tick` (the retiring skip lives in `scheduleSampling` in `daemon.ts`, outside the controller).
- Keep the existing `if (isRetiring()) return` immediately after self-heal so a generation still retiring after a failed self-heal attempt continues to skip digest triggering until self-heal succeeds — rules out removing the admission-cut guard.
- Self-heal does not run when `handoffHandlers.isPending()`, `blocksRollbackReopen`, or `retireCause !== "handoff_origin"` — enforced via the 00 predicate inputs, not duplicate inline checks — rules out divergent guard logic and rules out calling `probePublicServer` from the tick.
- A generation retiring after a committed handoff keeps draining and exits via `shouldShutdownNow` unchanged, and an operator stop exits via `shutdownRequested` (it never sets `retiring`); self-heal never clears `retiring` for it — rules out changing the drain/exit path.
- Add `v2/src/daemon/daemon-retiring-sole-self-heal.test.ts` using `startDaemonRuntime` startup deps (fake IPC bind, injectable sampling loop or interval seam, controllable retiring / pending / publicBound / rollback-block / retire-cause fakes; no real probes or successor processes) — rules out sandbox-only coverage for the interval ordering fix.

## Task checklist

- [x] Wire predicate evaluation and admission reopen ahead of the retiring skip in the production `scheduleSampling` callback.
- [x] Add focused regressions: matching incumbent reopens and admits `start`; pending handoff, `publicBound === false`, `blocksRollbackReopen === true`, committed-handoff retire, operator-stop retire, and stale-handoffId supersede each leave admission closed.
- [x] Update inline comment at the self-handoff sampling block to describe self-heal-before-skip ordering.
- [x] Align operator docs per Documentation updates.

## Acceptance criteria

- [x] `daemon-retiring-sole-self-heal.test.ts` leaves a retiring incumbent in the sole-owner stranded shape (public bound, no pending handoff, rollback not blocked, `retireCause === "handoff_origin"`), fires one self-handoff sampling tick through production wiring, and asserts a subsequent `start` is admitted; it fails against the pre-fix code reachable on main where every tick returns early on `isRetiring()` with no self-heal path.
- [x] The same test file asserts self-heal does not run while a handoff is pending, and that the tick invokes no public liveness probe (fakes only).
- [x] The same test file asserts a generation retiring after a committed handoff stays `retiring` across ticks and exits via `shouldShutdownNow` unchanged, and that an operator stop exits via `shutdownRequested` without self-heal.
- [x] The same test file asserts a `supersede` carrying a `handoffId` that matched a now-finished transaction (`pendingHandoffId` undefined) blocks self-heal: admission stays closed.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [x] `v2/docs/daemon-host.md` § Autonomous self-handoff — retiring sole-owner self-heal on the stable-digest sampling tick reopens admission after a handoff-origin retire when the public listener is still held and no handoff is pending; sampling and backoff retry proceed on later ticks.
- [x] `v2/docs/operator-runbook.md` § Daemon lifecycle — stranded `daemon_superseded` on a sole daemon after failed self-handoff may self-recover on the sampling cadence when self-heal applies; `jarvis daemon start` remains the manual fallback.
- [x] `v2/docs/v1-behaviors.md` — `[v2-only]` autonomous self-handoff / handoff bullets: note sole-owner self-heal on the stable-digest sampling tick.
