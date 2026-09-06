# 01 - Unify socket classifier for cleanup reaping

## Problem

Startup reclaim (subspec 00) and `jarvis cleanup`'s `reapDeadDaemonSockets` reach opposite verdicts on the same path today: cleanup's private `classifySocket` in `v2/src/commands/daemon.ts` duplicates connect-probe logic already owned by the IPC layer, so a path cleanup correctly classifies dead can still wedge `daemon start`.

## Decisions

- `reapDeadDaemonSockets` delegates connect-probe classification to the shared classifier exported from `v2/src/ipc/server.ts`; rules out maintaining a second `classifySocket` implementation in `daemon.ts`.
- Cleanup's `health` RPC success remains the live confirmation on top of the shared classifier's connect result; rules out dropping the health check and treating any successful TCP-style connect as live without an answering daemon.
- Preserved-socket reporting (`timeout`, permission error, unexpected throw) keeps today's stdout shape; rules out changing cleanup operator output in this slice.

## Prerequisites

- Subspec 00 exports the shared socket-path classifier from `v2/src/ipc/server.ts`.

## Task checklist

- [ ] Replace `classifySocket`'s connect-probe branch in `v2/src/commands/daemon.ts` with the shared IPC classifier.
- [ ] Add a regression test proving startup reclaim and cleanup reaper agree on the same path classification.

## Acceptance criteria

- [ ] `v2/src/commands/daemon.test.ts` test `startup reclaim and cleanup reaper classify an identical path identically` proves the shared classifier and `reapDeadDaemonSockets` reach the same dead/live verdict on a constructed path; it fails against the pre-fix duplicated logic.
- [ ] `v2/src/commands/daemon.test.ts` `reapDeadDaemonSockets` tests stay green (behavior unchanged for live, dead, preserved, and enumeration-failure cases).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

None — `daemon-host.md` and `v1-behaviors.md` carry the operator-facing contract in subspecs 00 and 03.
