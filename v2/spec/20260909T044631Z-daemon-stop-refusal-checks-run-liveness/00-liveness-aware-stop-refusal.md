# 00 - Liveness-aware stop refusal with stop-time reconciliation

## Problem

`assertStopAllowed` in `v2/src/daemon/daemon-lifecycle.ts` filters `listRuns()` on `!isTerminalRunStatus` and throws `DaemonStopRefusedError(runIds)` — a bare id list, no liveness. A non-terminal row the daemon no longer holds in memory (a crashed or superseded owner, a lost handoff) blocks `daemon stop` forever, while `run kill` refuses it as `run_not_active`. Startup reconciliation (`reconcileOrphanedRuns` in `daemon.ts`) already knows how to settle such rows, but only a fresh daemon runs it.

## Decisions

- Liveness comes from the daemon being stopped: `stopDaemon` asks it for its live run ids over the socket before refusing (`list` RPC rows with `isLive`, through an injectable `listLiveRunIds(socketPath)` seam that defaults to the real RPC); a daemon that does not answer counts every non-terminal row as live, because an unreachable daemon is not evidence that nothing is running; rules out refusing on durable status alone and rules out treating socket silence as permission.
- The refusal set is non-terminal **and** live. `DaemonStopRefusedError` carries `liveRunIds` and `orphanedRunIds` and its message names each group (`live: a, b; orphaned (will be reconciled): c`); with no live rows the stop proceeds; rules out a bare id list that reads identically in the guard-working and deadlock cases.
- After the daemon process has exited, `stopDaemon` reconciles the orphaned non-terminal rows through the same `reconcileOrphanedRuns` path startup uses (`beginRunReconciliation` → `commitTerminalRunSettlement` as `killed` / `interrupted` → `run_reconciled` with reason `daemon_restart`), against the same log stream; `reconcileOrphanedRuns` moves to `v2/src/daemon/daemon-run-reconciliation.ts` so lifecycle and startup share one module without a cycle; rules out a second settlement code path.
- `--force` keeps its current semantics (skip the refusal) and additionally reconciles orphans on the way down; `run kill --force` stays the path for a stale row while the daemon is up; rules out widening force-kill semantics.

## Tasks

- Add `listLiveRunIds` to `stopDaemon` options with a real-RPC default; compute live and orphaned sets; rewrite `DaemonStopRefusedError`.
- Extract `reconcileOrphanedRuns` and call it from `stopDaemon` after `terminateProcess` (and after `shutdown` when no pid is known), with `logsPath` defaulting beside the state store and injectable for tests.
- Extend the `stopDaemon` tests in `daemon-lifecycle.sandbox-unrunnable.test.ts`; update `commands/daemon.ts` stop output to print both groups.

## Acceptance criteria

- [ ] `daemon-lifecycle.sandbox-unrunnable.test.ts` test `stopDaemon settles an orphaned non-terminal row instead of refusing` proves a store holding an `in-progress` row the daemon does not report live lets the stop proceed and leaves the row `killed` with a `run_reconciled` log record; it fails against the current `!isTerminalRunStatus`-only filter.
- [ ] `daemon-lifecycle.sandbox-unrunnable.test.ts` test `stopDaemon still refuses a live non-terminal row and names it live` proves a row the daemon reports live refuses with `liveRunIds` containing it; it fails against a fix that simply stops refusing.
- [ ] `daemon-lifecycle.sandbox-unrunnable.test.ts` test `stopDaemon refusal names live and orphaned rows separately` proves a store with one live and one orphaned row refuses with both groups populated and the message naming each.
- [ ] `daemon-lifecycle.sandbox-unrunnable.test.ts` test `stopDaemon treats an unreachable daemon as all-live` proves that when `listLiveRunIds` rejects, every non-terminal row is refused as live.
- [ ] Existing `stopDaemon` cases (terminal statuses allowed, store failure refused, force paths) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — retire the `kill -9` recovery for the deadlock shape; keep the superseded-daemon and unlinked-socket liveness checks.
- `v2/docs/daemon-host.md` — stop-time reconciliation of orphaned non-terminal rows and the two-group refusal.
- `v2/docs/v1-behaviors.md` — record the liveness-aware stop refusal.
