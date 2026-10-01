# singleSpawn reaps descendant process groups on abort paths

## Problem

`killProcessGroup` in `shared/invocation/agents.ts` signals only `-child.pid`. Agent shell tools run commands in separate session groups, so abort, idle stall (`joinProcessOnIdleStall`), and iteration timeout (`AbortSignal`) leave grandchildren running. When the agent leader exits after SIGTERM, `settle` clears the pending SIGKILL timer while a descendant group may still be alive.

## Decision ledger

- While the agent child is still alive, take one async process-tree snapshot (`ps -A -o pid=,ppid=,pgid=`, walk `ppid` links from `child.pid`) and collect every distinct `pgid` on that descendant subtree; rules out polling `ps` on every kill or walking only direct children.
- On abort (`opts.signal`), idle stall with `joinProcessOnIdleStall`, and any other path that already calls `killProcessGroup` for operator/iteration cancellation, SIGTERM each distinct snapshotted foreign group (via shared `isForeignProcessGroup`), then SIGTERM the agent group using the same `killProcessGroup` helper; rules out a separate kill implementation for iteration timeout vs operator abort.
- After `abortKillGraceMs`, SIGKILL every group recorded in the snapshot (foreign descendants and the agent group); `settle` must not clear or replace those escalation timers; rules out cancelling SIGKILL when the leader process closes first.
- Add injectable seams on the agent run options for the process-tree probe and for group-level `process.kill(-pgid, signal)` (spawn injection already exists); rules out live `ps` or real cross-group signals in unit tests.
- Deferred to first consumer: exact shared module/file names for the snapshot walker and kill seam types — pin when wiring the first test double.

## Out of scope

- Vendor shell-tool framing or command shapes.
- Descendants orphaned before any snapshot when the daemon process itself has crashed.

## Task checklist

- Import shared `isForeignProcessGroup` / `ownProcessGroupIds` in `agents.ts`.
- Implement snapshot-at-kill wiring inside `singleSpawn` and extend `killProcessGroup` to use the snapshotted group set.
- Ensure iteration-timeout abort listeners and idle-stall `joinProcessOnIdleStall` both route through the extended `killProcessGroup`.
- Stop `settle` from cancelling pending SIGKILL escalation timers for snapshotted groups.
- Add regression tests in `shared/invocation/agents.test.ts` using injected spawn, process-tree probe, and group-kill seams.
- Update operator-facing docs and v1 parity catalog.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` proves abort with an agent child plus a descendant in a separate process group SIGTERMs every snapshotted group through the shared `killProcessGroup` path; fails against pre-fix (only `-child.pid` signalled).
- [ ] `shared/invocation/agents.test.ts` proves iteration timeout via `AbortSignal` uses the same `killProcessGroup` path and SIGTERMs every snapshotted group; fails against pre-fix (only the agent group).
- [ ] `shared/invocation/agents.test.ts` proves that when the leader closes after SIGTERM while a descendant group remains listed, SIGKILL is sent to that group after `abortKillGraceMs`; fails against pre-fix (`settle` clears the escalation timer).
- [ ] `shared/invocation/agents.test.ts` proves idle stall with `joinProcessOnIdleStall` signals descendant groups the same way as abort; fails against pre-fix (agent group only).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — agent abort, idle stall (`joinProcessOnIdleStall`), and iteration timeout reap descendant process groups; SIGKILL escalation survives leader settlement.
- `v2/docs/v1-behaviors.md` — same contract in the parity catalog (v2 behavior change / additive entry as appropriate).
