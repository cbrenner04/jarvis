---
name: agent-abort-reaps-descendant-groups
---

# Agent abort reaps descendant process groups

## Problem

`singleSpawn` signals only the agent's own process group on abort, idle stall, and iteration timeout. Agent shell tools spawn commands in separate session groups, so group kill leaves grandchildren running; `settle` clears SIGKILL escalation when the leader exits while a descendant group survives.

## Behavior

Move `ownProcessGroupIds` / `isForeignProcessGroup` from `v2/src/execution/verifier-process-groups.ts` into `shared/` (v2 imports shared; no `shared/**` → `v2/**`). While the agent child is still alive, snapshot its descendant tree (one async `ps -A -o pid=,ppid=,pgid=`, walk `ppid` from `child.pid`). On abort, idle stall (`joinProcessOnIdleStall`), and iteration timeout, SIGTERM every distinct descendant group (skip own ids via the shared predicate), then the agent group. Iteration timeout uses the same `killProcessGroup` path as operator abort (`opts.signal` abort listener). After `abortKillGraceMs`, SIGKILL every snapshotted group; settlement does not cancel those timers. Inject seams for spawn, process-tree probe, and group kill in tests.

Out of scope: vendor shell-tool behavior; descendants orphaned before snapshot when the daemon crashes.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts`: injected spawn plus injected process-tree probe/kill seams, agent child with a descendant in a separate group; abort and iteration timeout (`AbortSignal`) both signal every snapshotted group with SIGTERM via the same `killProcessGroup` path; fails against pre-fix (only `-child.pid` signalled).
- [ ] `shared/invocation/agents.test.ts`: leader closes after SIGTERM while a descendant group remains listed; SIGKILL fires to that group after the grace; fails against pre-fix (`settle` clears the timer).
- [ ] `shared/invocation/agents.test.ts`: idle stall with `joinProcessOnIdleStall` signals descendant groups the same way; fails against pre-fix (agent group only).
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — agent abort, idle stall, and iteration timeout reap descendant process groups; SIGKILL escalation survives leader settlement.
- `v2/docs/v1-behaviors.md` — same contract for the parity catalog.

## Primary implementation surface

shared/invocation/agents.ts, shared process-group predicate (moved from `v2/src/execution/verifier-process-groups.ts`), `v2/src/execution/verifier-process-groups.ts` (import shared)

## Prerequisites
