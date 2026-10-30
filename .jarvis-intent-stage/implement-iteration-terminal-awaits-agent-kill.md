---
name: implement-iteration-terminal-awaits-agent-kill
---

# Implement iteration terminal settlement waits for agent subtree kill

## Problem

The write loop can commit `idle_output_timeout` (and comparable harness kill outcomes) while `singleSpawn` is still SIGTERM/SIGKILL-ing the agent tree, so the operator sees a settled run and notifications while descendant tool shells keep burning CPU.

## Behavior

Run settlement must not persist terminal loop/run outcome until the active agent invocation's subtree kill has finished (kill grace elapsed and escalation timers fired, or an explicit join seam reports quiescence). Hand off to daemon sweep only when invoke-layer kill cannot complete in bounded time — still no parallel reaper.

Plan ties the wait to the production bounded-implement path (`joinProcessOnIdleStall: true`, run-row `processGroupRecorder`).

## Documentation updates

- `docs/write-behavior.md` — implement iteration idle stall / abort settlement waits for agent subtree kill before terminal commit (cross-link shared invocation invariant).

## Primary implementation surface

- `src/execution/write-loop.ts`

## Prerequisites

- Harness-ended agent invocation leaves no live process in the snapshotted subtree past kill grace, and invoke settle clears each run-row pgid only after that pgid's group is confirmed gone. (delivered by: agent-subtree-no-survivors-after-kill)
