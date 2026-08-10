---
name: sweep-orphaned-ready-gate-tests-on-daemon-start
---

# Sweep orphaned ready-gate tests on daemon start

## Surface

- Daemon.

## Problem

Clean termination cannot recover test process groups left by abandonment or daemon loss, so leaked ready-gate descendants persist across sessions and interfere with unrelated runs.

## Decision ledger

- Before admitting recovery work, daemon startup enumerates durable ready-gate test ownership and reaps each identity-valid group whose run was abandoned, reconciled after daemon loss, or otherwise has no live owner. Rules out relying only on the spawning daemon's clean-settlement path.
- Treat a group as live only when its owning run is active and its recorded daemon lease is live at sweep time; a stale run record or expired lease is sweepable, while either check changing during the claim leaves the group untouched. Rules out a new daemon disrupting concurrent work from another executable-keyed daemon.
- Signal the whole orphaned process group and clear its exact ownership record after the group is gone; clear already-absent groups without signaling. Rules out leaving descendants or repeatedly sweeping stale records.
- Keep startup reconciliation, recovery admission, and healthy ready-gate execution otherwise unchanged. Rules out broad daemon lifecycle or gate-policy changes.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` — `reaps an orphaned ready-gate test group before recovery admission` fails against the baseline, then proves startup signals its entire identity-valid group and clears the record before admission.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` — `does not reap a ready-gate group with a live peer owner`; Mutation checkpoint: bypassing the active-run and live-lease guard signals the peer-owned group and makes the scoped regression fail.
- [ ] Startup regressions leave identity-valid groups owned by live runs or live peer daemons untouched and reject stale identity records without signaling unrelated processes.
- [ ] Repeating startup after a successful or already-absent orphan sweep is a no-op.
- [ ] Existing run reconciliation and recovery admission regressions remain green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document the pre-recovery startup sweep, live-owner exclusion, process-identity guard, and durable-record cleanup.
- `v2/docs/operator-runbook.md` — record automatic startup orphan reaping and remove the standing manual `bun test` orphan-kill gotcha.
- `v2/docs/v1-behaviors.md` — catalog v2 daemon-start ready-gate orphan recovery.

## Prerequisites

- The v2 state store durably registers, enumerates, identity-validates, and compare-and-clears a ready-gate test process-group record tied to its owning run.
- Ready finalization spawns each test invocation in a dedicated process group, records it against the run, reaps it on live run termination, and clears the record after normal settlement.
