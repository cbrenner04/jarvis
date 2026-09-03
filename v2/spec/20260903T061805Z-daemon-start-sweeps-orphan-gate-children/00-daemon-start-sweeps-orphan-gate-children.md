# 00 - Daemon start sweeps orphaned ready-gate test process groups

Module boundary: daemon (`v2/src/daemon/daemon.ts`).

Depends on landed `ready_gate_pgid` recording (`setReadyGatePgid`, cleared on gate/required-integration settlement) and group-mode signaling in `shared/subprocess.ts` (SIGTERM→SIGKILL on `-pgid`). This subspec is the deferred first consumer of that durable id: reap ready-gate test descendants whose owning run is no longer live when a new daemon starts.

## Decisions

- The sweep runs after `reconcileOrphanedRuns` returns and immediately before `createRunControlHandlers` (revision/digest load stays between reconciliation and the sweep; IPC opens only after handlers are built) — rules out placement after `createRunControlHandlers` or after `startIpcServer` (clients can connect while gate descendants leak) or folding the work into post-IPC recovery (too late for the daemon-loss case this sweep exists for).
- Candidates and owner liveness come from a new `StateStore.listReadyGateSweepCandidates()` that SQL-selects non-null `ready_gate_pgid` rows and applies the same `owner_identity` + `isOwnerAlive` probe as `beginRunReconciliation`/`forceKillOwnerAdmits` — rules out raw SQL in `daemon.ts` and rules out duplicating owner reads outside the store.
- Candidates are every run row with non-null `ready_gate_pgid`, regardless of run `status` — rules out scanning only rows `reconcileOrphanedRuns` just admitted (terminal rows can still carry a stale pgid when the prior daemon died before the gate's settlement `finally` cleared it).
- A record is **live** when its run's `owner_identity` is non-null and the store's `isOwnerAlive` probe returns true for that identity — rules out using in-memory `isLive` (a fresh daemon has no `activeRuns` yet pre-IPC) and rules out signaling a group while a live foreground `jarvis write`, workflow runner, or peer daemon still owns the run.
- Rows with null `owner_identity` are not live — rules out leaving stale pgids on pre-migration or ownerless rows.
- Dead-owner rows signal the recorded `ready_gate_pgid` without age or recorded-at bounds — rules out a `ready_gate_recorded_at` migration in this subspec; recycled-pgid false positives are accepted because only dead-owner rows are swept, gate descendants are short-lived test trees, and the prior `00-persist-gate-group-id` deferral is resolved here by owner-liveness gating rather than pgid-age discrimination.
- Reap uses the same escalation as group-mode abort in `shared/subprocess.ts`: `process.kill(-pgid, "SIGTERM")`, then `process.kill(-pgid, "SIGKILL")` after the existing 50ms grace; `ESRCH` and `EPERM` are swallowed — rules out `child.kill()` (no recorded pgid to target) and rules out treating an already-dead group as a startup failure.
- After signaling (or determining the group is already gone), clear the record with `setReadyGatePgid(runId, null)` — rules out leaving the column set after a successful sweep.
- Export the sweep as `sweepOrphanReadyGateGroups` from `daemon.ts` (same testability pattern as `reconcileOrphanedRuns`) and call it from `startDaemonRuntime`; a sweep error fails daemon startup before IPC serves — rules out best-effort fire-and-forget that could leave leaks while the daemon accepts work.
- Deferred to first consumer: structured log events or operator notifications for swept groups — the intent names no audit surface; silence unless a later caller needs it.

## Task checklist

- [x] Add `listReadyGateSweepCandidates()` to `StateStore` (non-null `ready_gate_pgid` rows with owner-liveness classification).
- [x] Add `sweepOrphanReadyGateGroups(store: StateStore): Promise<void>` that iterates sweep candidates, skips live owners, signals non-live groups, and clears each swept record.
- [x] Invoke it from `startDaemonRuntime` after revision/digest load and immediately before `createRunControlHandlers`.
- [x] Add `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` covering orphan signal+clear, live-owner skip, already-dead group clear without startup failure, startup wiring order, and sweep failure preventing IPC (drive the sweep directly or through `startDaemonRuntime` with injected IPC/deps as in `daemon-reconciliation.test.ts`).
- [x] Update durable docs per below.

## Acceptance criteria

- [x] A seeded orphan `ready_gate_pgid` whose owning run is not live is signaled and its record cleared at daemon start, asserted in `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` test `sweeps a ready-gate pgid when the owning run owner is dead`; it fails against the pre-fix code.
- [x] A `ready_gate_pgid` whose owning run owner is still live is left untouched at daemon start, asserted in `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` test `leaves a ready-gate pgid alone when the owning run owner is live`; it fails against the pre-fix code.
- [x] A `ready_gate_pgid` that no longer exists on the host clears its record without failing daemon startup, asserted in `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` test `clears a stale ready-gate pgid when the process group is already gone`; it fails against the pre-fix code.
- [x] `startDaemonRuntime` invokes the ready-gate sweep after run reconciliation and immediately before `createRunControlHandlers`, and a sweep throw prevents `startIpcServer` from running, asserted in `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` test `startup sweeps ready-gate pgids before opening IPC and sweep failures prevent it` (mirror `daemon-reconciliation.test.ts` `startup reconciles before opening IPC and reconciliation failures prevent it`); it fails against the pre-fix code.
- [x] `v2/docs/daemon-host.md` § Restart reconciliation and recovery documents the pre-IPC ready-gate pgid sweep: candidate rows, live-owner skip via `owner_identity` liveness, SIGTERM→SIGKILL escalation, already-dead group handling, record clearing, recycled-pgid acceptance on dead-owner rows, and ordering after run reconciliation and revision/digest load and immediately before handler construction.
- [x] `v2/docs/operator-runbook.md` states that daemon start reaps orphaned ready-gate test process groups no live run owns (complementing the live run-termination reap path), and revises or retires the gotcha bullets at lines 824–825 that still prescribe manual `ps`/`pkill` sweeps or describe the daemon-start half as queued.
- [x] `v2/docs/state-store.md` `setReadyGatePgid` entry resolves the prior pgid-staleness deferral: documents `listReadyGateSweepCandidates`, sweep semantics relative to the column, and that dead-owner rows are signaled without recorded-at bounds (recycled-pgid risk accepted).
- [x] `v2/docs/v1-behaviors.md` updates the ready-gate process-group bullet to record that daemon start now performs the deferred reap sweep (no longer "future").
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — pre-IPC ready-gate pgid orphan sweep (see acceptance criterion).
- `v2/docs/operator-runbook.md` — daemon-start reap of orphaned gate test groups and gotcha alignment (see acceptance criterion).
- `v2/docs/state-store.md` — `setReadyGatePgid` / `listReadyGateSweepCandidates` sweep contract (see acceptance criterion).
- `v2/docs/v1-behaviors.md` — ready-gate process-group termination catalog entry (see acceptance criterion).
