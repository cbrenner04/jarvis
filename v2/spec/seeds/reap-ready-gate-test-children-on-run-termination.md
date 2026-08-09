---
name: reap-ready-gate-test-children-on-run-termination
---

# Reap ready-gate test children on run termination

## Problem

The v2 ready-gate runs the test suite by spawning `bun test` child processes. When a run is killed, abandoned, times out, or its daemon loses it, those children are not reaped — they keep running and pegging CPU for days across sessions. Observed 2026-08-09: three orphaned `bun test` processes aged `03-01:49`, `02-18:23`, and `02-02:09` were saturating CPU during an operator session, dragging debate reviews past 13 minutes and contributing to a contention-induced ready-gate repair failure (`completion_commit_failed`) on an unrelated run. This recurs (the brief's dogfood friction list already names it) and it actively corrupts concurrent runs, not just the leaking one.

## Decisions

- On any run termination (kill, abandon, iteration timeout, daemon-loss settle), the ready-gate must terminate the entire test child-process tree it spawned, not only the direct child — rules out leaving `bun test` grandchildren alive.
- Spawn the gate's test process in its own process group (or tracked descendant set) so the settle path can signal the whole group — rules out best-effort single-PID kills that miss the pool workers.
- On daemon start, sweep and kill orphaned ready-gate test descendants that no live run owns — rules out relying only on clean-termination reaping to recover pre-existing leaks.
- Scope to the ready-gate test invocation; no change to how tests are selected or run under a healthy, completing gate — rules out reworking the gate itself.

## Acceptance criteria

- [ ] Killing or abandoning a run while its ready-gate test invocation is mid-flight leaves no surviving `bun test` descendant; a regression drives a run to the gate, terminates it, and asserts the spawned test process group is gone.
- [ ] The gate spawns its test invocation in a killable process group (or equivalently tracked descendant set), pinned by a test that inspects the spawn options / recorded group id.
- [ ] Daemon start reaps orphaned ready-gate test descendants owned by no live run; a test seeds an orphan record and asserts it is signaled on startup.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that killed/abandoned/timed-out runs reap their ready-gate test children, and that daemon start sweeps orphans; remove any standing "manually kill leaked bun test" gotcha once this lands.
- `v2/docs/daemon-host.md` — note the startup orphan sweep for ready-gate test descendants.
