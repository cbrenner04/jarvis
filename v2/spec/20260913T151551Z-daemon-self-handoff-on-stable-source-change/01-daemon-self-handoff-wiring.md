# Daemon self-handoff wiring

## Problem

A merged source change leaves the old daemon generation serving until an operator starts a new one.

## Decisions

- Daemon startup starts the 00 controller with `getExecutableTreeDigest` as the sampler and `startDaemon` (existing spawn → `changeover` → readiness → commit/rollback path) as `startHandoff` — rules out a new handoff protocol or in-place restart.
- No self-dispatch deadlock: the incumbent calls `startDaemon` in-process, which spawns a new `detached: true`/`unref()`'d successor process exactly as today's CLI-invoked handoff does; that successor dials the incumbent's own public socket as an ordinary IPC client for the `changeover` RPC. The incumbent's IPC server keeps servicing its own event loop and answers normally — it never blocks on a synchronous self-call. The successor already survives the outgoing generation's exit because it's already spawned detached; no change needed there.
- Any `startDaemon` rejection (spawn error, `DaemonHandoffFailedError`, `DaemonReadinessTimeoutError`, or any other failure) is surfaced as a rejected `startHandoff` promise, which 00's controller treats as `"rolled_back"` — rules out distinguishing failure types at the wiring layer or restarting the incumbent in place.
- Sampling and successor startup run async off the IPC path — rules out blocking request handling on digest computation.
- The sampling loop stops sampling and triggering as soon as `isRetiring()` is true, regardless of whether a client-initiated `changeover` or this controller's own `startHandoff` call cut admission — rules out relying only on retire/supersede/shutdown teardown, which fires too late to prevent a redundant trigger.
- A self-handoff never starts while a client-initiated handoff is already pending (existing handoff-pending state) — rules out a race spawning two successors.
- Sampling interval defaults to 30s and is injectable via the daemon startup deps, the same seam pattern as `startDrainExitLoop`'s `intervalMs` — rules out daemon-level tests needing a real wait.
- Stop the controller when the generation retires, supersedes, or shuts down, in addition to the `isRetiring()` check above — teardown backstop, not the primary cutoff signal.
- Skip the controller when the loaded digest is `unknown` — rules out handing off from a daemon with no baseline.
- Log one process-log line at initiation naming loaded and observed digests as self-handoff cause.

## Acceptance criteria

- [ ] A daemon-level regression test injects a fake sampler through the same startup-deps injection seam as the interval, returning one divergent digest for two consecutive samples, exercises the real daemon startup wiring, and asserts successor startup begins with no client request; it fails against the pre-fix daemon.
- [ ] A test proves a run admitted before self-handoff completes normally under the outgoing generation without interruption.
- [ ] A test proves sampling stops as soon as `isRetiring()` is set — whether by a client-initiated changeover or by this controller's own trigger — and that no second successor is spawned after the cut or after commit.
- [ ] A test proves a self-handoff does not start while a client-initiated handoff is already pending.
- [ ] A test proves successor startup failure restores incumbent admission via the existing rollback and a later retry needs two fresh matching samples.
- [ ] A test proves the initiating generation's process log records both loaded and observed digests as the self-handoff cause.
- [ ] `v2/docs/daemon-host.md` describes autonomous sampling, two-sample stability, single-flight (including the pending-client-handoff and admission-cut stop conditions), drain preservation, rollback retry reset, and logged cause.
- [ ] `v2/docs/operator-runbook.md` states merged executable changes take effect after automatic handoff and drain, and explains `daemon status` loaded/current during convergence.
- [ ] `v2/docs/v1-behaviors.md` records autonomous v2 daemon generation replacement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — autonomous self-handoff mechanics, including the admission-cut stop and pending-handoff guard.
- `v2/docs/operator-runbook.md` — convergence after merge; status output.
- `v2/docs/v1-behaviors.md` — autonomous generation replacement.
