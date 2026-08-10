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
- Thread the active run's abort through publication, ready finalization, and test execution; on kill or timeout, signal the entire test group and wait for it to disappear before run settlement completes. Rules out a terminal run row while its gate tests remain live.
- Register the test group against the durable run immediately after spawn and compare-and-clear it only after group exit; leave the record recoverable if the harness process disappears first. Rules out an unowned spawn window and crash cleanup that depends on `finally` running.
- Preserve healthy ready-gate commands, scoping, ordering, retry, timeout, and failure classification. Rules out reworking test selection or gate policy while fixing lifecycle cleanup.

## Acceptance criteria

- [ ] A regression drives a run into a held ready-finalization test invocation, terminates the run, and proves the entire spawned process group is gone before the run settles.
- [ ] A spawn-level regression pins the dedicated process-group option or recorded group identity and proves descendant signaling targets the group rather than only the direct child.
- [ ] Registration and compare-and-clear regressions prove a normally settled gate leaves no active ownership record while abrupt harness loss leaves a record for startup recovery.
- [ ] Healthy green and red ready-gate regressions retain their existing commands, scope, retry, timeout, and outcome behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that killed and timed-out live runs reap their ready-gate test process trees before settlement; retain crash-orphan recovery guidance until the startup sweep lands.
- `v2/docs/v1-behaviors.md` — catalog v2 live-run ready-gate process-tree reaping and unchanged healthy gate semantics.

## Prerequisites

- The v2 state store durably registers, enumerates, identity-validates, and compare-and-clears a ready-gate test process-group record tied to its owning run.
