---
name: implement-iteration-terminal-awaits-agent-kill
---

# Implement iteration terminal settlement waits for agent subtree kill

## Problem

The write loop can commit `idle_output_timeout`, operator abort, or iteration wall-clock timeout while `singleSpawn` is still SIGTERM/SIGKILL-ing the agent tree, so the operator sees a settled run and notifications while descendant tool shells keep burning CPU.

## Behavior

Run settlement must not persist terminal loop/run outcome until the active agent invocation's subtree kill has finished (kill grace elapsed and escalation timers fired, or the join seam reports quiescence). Wait bound and daemon handoff are pinned in ## Decisions — still no parallel reaper.

Plan ties the wait to the production bounded-implement path (`joinProcessOnIdleStall: true`, run-row `processGroupRecorder`).

## Decisions

- Terminal wait on every path that already arms group kill on the active bounded-implement invocation: idle stall with `joinProcessOnIdleStall`, operator abort, iteration wall-clock timeout.
- Bounded wait = invoke kill contract only: through each armed pgid's `abortKillGraceMs` SIGTERM→SIGKILL escalation and the join seam's quiescence report; no extra write-loop cap. Live descendants after escalation may still terminal-commit with recorded pgids left for daemon `signalRecordedVerifierProcessGroups` — no invoke-layer parallel reaper.

## Documentation updates

- `docs/write-behavior.md` — implement iteration idle stall / abort settlement waits for agent subtree kill before terminal commit (cross-link shared invocation invariant).

## Primary implementation surface

- `src/execution/write-loop.ts`

## Prerequisites

- Harness-ended agent invocation leaves no live process in the snapshotted subtree past kill grace, and invoke settle clears each run-row pgid only after that pgid's group is confirmed gone. (delivered by: agent-subtree-no-survivors-after-kill)

## Acceptance criteria

- [ ] `write-loop-agent-process-groups.test.ts`: on the production bounded-implement path (`joinProcessOnIdleStall: true`, run-row `processGroupRecorder`), idle stall, operator abort, and iteration wall-clock timeout do not persist terminal loop/run outcome until the active invocation's subtree kill finishes per ## Decisions; fails against main.
