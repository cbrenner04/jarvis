---
name: reap-ready-gate-tests-on-live-run-termination
---

# Reap ready-gate tests on live run termination

## Surface

- Execution loop.

## Problem

Run termination does not join the ready-finalization test subprocess tree, allowing `bun test` descendants to outlive the run and consume resources indefinitely.

## Decision ledger

- Run each ready-finalization test invocation in a dedicated process group whose descendants inherit that group. Rules out direct-child PID kills that leave test workers alive.
- Thread the active run's abort through publication, ready finalization, and test execution; on kill or run-level timeout, signal the entire test group and wait for it to disappear before run settlement completes. This does not change existing ready-gate test timeout behavior. Rules out a terminal run row while its gate tests remain live.
- Register the test group against the durable run immediately after spawn and compare-and-clear it only after group exit; leave the record recoverable if the harness process disappears first. Rules out an unowned spawn window and crash cleanup that depends on `finally` running.
- Preserve healthy ready-gate commands, scoping, ordering, retry, timeout, and failure classification. Rules out reworking test selection or gate policy while fixing lifecycle cleanup.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` — `reaps a held ready-gate test group when its run terminates` fails against the baseline, then proves a killed or run-timed-out run removes the entire group before settlement.
- [ ] `v2/src/execution/ready-finalize.test.ts` — `signals ready-gate test descendants as a group`; Mutation checkpoint: changing group signaling to direct-child signaling leaves a held descendant alive and makes the scoped regression fail.
- [ ] Registration and compare-and-clear regressions prove a normally settled gate leaves no active ownership record while abrupt harness loss leaves a record for startup recovery.
- [ ] Healthy green and red ready-gate regressions retain their existing commands, scope, retry, test-level timeout, and outcome behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that killed and run-timed-out live runs reap their ready-gate test process trees before settlement, without changing ready-gate test timeout handling; retain crash-orphan recovery guidance until the startup sweep lands.
- `v2/docs/v1-behaviors.md` — catalog v2 live-run ready-gate process-tree reaping and unchanged healthy gate semantics.

## Prerequisites

- The v2 state store durably registers, enumerates, identity-validates, and compare-and-clears a ready-gate test process-group record tied to its owning run.
