---
name: agent-subtree-no-survivors-after-kill
---

# Agent invocation kill leaves no live subtree past grace

## Problem

After `idle_output_timeout`, implement run `147dca0f-b4c1-4348-b414-b1bc98546975` settled while the cursor agent and five detached-pgid bash tool shells stayed at 100% CPU. `singleSpawn` already snapshots descendants, signals groups, and schedules SIGKILL after `abortKillGraceMs` with `joinProcessOnIdleStall`; something on that path let survivors remain — kill never ran, escalation never fired, or `processGroups.settle()` cleared run-row pgids while groups were still alive.

## Behavior

Reproduce first with a fake agent that stalls on output and spawns a detached-pgid child ignoring SIGTERM (`trap '' TERM; while :; do :; done`), then fix the identified gap in the existing `killProcessGroup` / invoke-settle path — no parallel reaper.

Invariant: whenever the harness ends an agent invocation (idle stall, abort, iteration timeout, any path that already arms group kill), no process in the agent subtree survives past `abortKillGraceMs`; survivors are SIGKILLed.

Recorded process groups clear from the run row only after each group's processes are confirmed gone; a group still alive at invoke settle stays recorded so downstream settlement can still signal it.

Out of scope: reaping hung tool shells while the agent is still running.

## Documentation updates

- `docs/shared-invocation.md` — idle-stall and abort kill semantics state the no-survivors invariant and deferred recorder clear.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry for the invariant and recorder-clear timing.

## Primary implementation surface

- `src/shared/invocation/agents.ts`

## Prerequisites

- Agent abort, idle stall with `joinProcessOnIdleStall`, and iteration-timeout abort snapshot foreign descendant process groups, SIGTERM each, and schedule SIGKILL after `abortKillGraceMs` without cancelling escalation at invoke settle. (already true: agent-abort-reaps-descendant-groups merged)
- Bounded implement iterations record the agent pgid and snapshotted descendant pgids on the run row via `storeVerifierProcessGroupRecorder`. (already true: implement-run-records-agent-process-groups merged)

## Acceptance criteria

- [ ] `agents.test.ts`: fake agent idle-stalls with output, spawns a detached-pgid child ignoring SIGTERM (`trap '' TERM; while :; do :; done`), and with `joinProcessOnIdleStall` asserts every snapshotted pgid gets SIGKILL after `abortKillGraceMs` with no live processes in those groups when invoke settles; fails against main (reachable on paths like `idle stall with joinProcessOnIdleStall SIGTERMs descendant process groups` that stop at SIGTERM).
- [ ] `agents.test.ts` or `write-loop-agent-process-groups.test.ts`: a recorded pgid whose group is still alive at invoke settle stays on the run row until that group is confirmed gone; fails against main if settle clears the id while descendants remain.
