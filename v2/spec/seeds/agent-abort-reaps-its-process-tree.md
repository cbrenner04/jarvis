---
name: agent-abort-reaps-its-process-tree
---

# Agent abort reaps the agent's whole process tree

## Problem

`singleSpawn` (`shared/invocation/agents.ts`) spawns the agent `detached: true` (:508) and on abort/stall signals only the agent's own group, `process.kill(-child.pid, …)` (`killProcessGroup`, :583-603). Agent shell tools put each command in a new session: cursor-agent runs every shell call as `/bin/bash -O extglob -c …` with `pgid == pid`, `STAT Ss`, parent = cursor-agent. The group kill misses those sessions; when cursor-agent dies they reparent to launchd and keep running. Two further gaps: `settle` clears the pending SIGKILL escalation (:557-559) as soon as the leader closes after SIGTERM, so a group member that outlives SIGTERM is never SIGKILLed; and the agent group is not recorded on the run row (only verifier groups are, `v2/src/execution/verifier-process-groups.ts`), so run kill and daemon-start sweep (`signalRecordedVerifierProcessGroups`, `v2/src/daemon/daemon.ts:191`) never reach it.

## Evidence

- 2026-10-01: after iteration_timeout (45 min) on cursor implement run cd5e5790, pid 55854 `bun test v2/src/execution/` (cwd = that run's worktree) at 97% CPU 45 min post-kill, ppid 1, pgid 55854; pid 69074 `bun run test:v2` ppid 1, own group, ~20 min. Load ~31; four consecutive iteration_timeouts on concurrent lanes.
- Live tree: cursor-agent 54042 (pgid 54042) → `/bin/bash … -c` 82429 (pgid 82429, Ss); cursor-agent 27735 → bash 87173 (pgid 87173, Ss).

## Decisions

- On abort, idle stall, and iteration timeout, snapshot the agent's descendant tree (one async `ps -A -o pid=,ppid=,pgid=`, walk ppid from `child.pid`) while the agent is still alive, then SIGTERM every distinct descendant group (skipping our own via `isForeignProcessGroup`), then the agent group.
- SIGKILL escalation after `abortKillGraceMs` survives settlement: it fires for every snapshotted group regardless of leader close; settle does not cancel it.
- Record the agent group and each snapshotted descendant group on the run row through the existing verifier process-group recorder (record at spawn / at snapshot, clear on settle), so run kill and daemon-start sweep signal them like verifier groups.
- Out of scope: descendants that escaped and were orphaned before any snapshot when the daemon itself crashed; changing vendor shell-tool behavior.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts`: injected spawn + injected process-tree probe/kill seams, agent child with a descendant in a separate group; abort signals both groups with SIGTERM; fails against pre-fix (only `-child.pid` signalled).
- [ ] `shared/invocation/agents.test.ts`: leader closes after SIGTERM, a descendant group is still listed; SIGKILL fires to it after the grace; fails against pre-fix (`settle` clears the timer).
- [ ] `shared/invocation/agents.test.ts`: idle-stall with `joinProcessOnIdleStall` signals descendant groups the same way.
- [ ] `v2/src/execution/write-loop.test.ts`: an implement iteration records the agent pgid on the run row (`store.verifierProcessGroups(runId)`) while running and clears it on settle; fails against pre-fix (empty).
- [ ] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts`: a run row carrying a recorded agent group from a dead daemon is signalled at startup sweep.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — agent abort/timeout reaps the agent's descendant groups; SIGKILL escalation.
- `v2/docs/operator-runbook.md` — recorded process groups now include the agent tree; leaked `bun test` after timeout is a bug, not expected.
