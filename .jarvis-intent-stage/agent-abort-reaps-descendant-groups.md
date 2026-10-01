---
name: agent-abort-reaps-descendant-groups
---

# Agent abort reaps descendant process groups

## Problem

`singleSpawn` signals only the agent's own process group on abort, idle stall, and iteration timeout. Agent shell tools spawn commands in separate session groups, so group kill leaves grandchildren running; `settle` clears SIGKILL escalation when the leader exits while a descendant group survives.

## Behavior

While the agent child is still alive, snapshot its descendant tree (one async `ps -A -o pid=,ppid=,pgid=`, walk `ppid` from `child.pid`). On abort, idle stall (`joinProcessOnIdleStall`), and iteration timeout, SIGTERM every distinct descendant group (skip own ids via `isForeignProcessGroup`), then the agent group. After `abortKillGraceMs`, SIGKILL every snapshotted group; settlement does not cancel those timers. Inject seams for spawn, process-tree probe, and group kill in tests.

Out of scope: vendor shell-tool behavior; descendants orphaned before snapshot when the daemon crashes.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts`: injected spawn plus injected process-tree probe/kill seams, agent child with a descendant in a separate group; abort signals both groups with SIGTERM; fails against pre-fix (only `-child.pid` signalled).
- [ ] `shared/invocation/agents.test.ts`: leader closes after SIGTERM while a descendant group remains listed; SIGKILL fires to that group after the grace; fails against pre-fix (`settle` clears the timer).
- [ ] `shared/invocation/agents.test.ts`: idle stall with `joinProcessOnIdleStall` signals descendant groups the same way.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — agent abort, idle stall, and iteration timeout reap descendant process groups; SIGKILL escalation survives leader settlement.
- `v2/docs/v1-behaviors.md` — same contract for the parity catalog.

## Primary implementation surface

shared/invocation/agents.ts

## Prerequisites
