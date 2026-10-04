---
name: tui-aggregates-live-daemons
---

# Show every live daemon in one TUI

## Problem

- A TUI connected to one socket loses the operator's live view when a newer digest takes over dispatch.
- Overlapping daemons split run ownership across sockets.

## Outcome

- One running TUI discovers every live daemon, renders one run view, and follows daemon supersession without restart.

## Decisions

- Discover and poll the live socket set throughout the TUI session; rules out a startup-only snapshot or one fixed connection.
- Deduplicate daemon list results by run ID and preserve the owning daemon route; rules out duplicate rows or steering through an arbitrary socket.
- Keep superseded daemon connections until exit while adding new daemon connections; rules out dropping old live runs when dispatch moves.
- Aggregate only the TUI monitor; rules out expanding `run list` and `run wait` into multi-daemon commands.

## Acceptance criteria

- [ ] The TUI renders runs owned by every live daemon without duplicate run rows.
- [ ] A running TUI discovers a newly started daemon without operator action.
- [ ] Runs on the superseded and superseding daemons remain visible together until the older daemon exits.
- [ ] Selection, wait, pause, resume, and kill target the daemon responsible for the selected run.
- [ ] An exited daemon is removed without terminating or freezing the TUI.
- [ ] `run list` and `run wait` remain scoped to one selected daemon.
- [ ] A regression test in `v2/src/commands/tui.test.ts` proves one running TUI shows runs from newly discovered live daemons; it fails on baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — daemon discovery boundary used by the TUI.
- `v2/docs/write-behavior.md` — aggregation, refresh, selection, and steering behavior.
- `v2/docs/operator-runbook.md` — the TUI as the cross-daemon observation surface.
- `v2/docs/v2-architecture.md` — multi-connection TUI ownership boundary.
- `v2/docs/v1-behaviors.md` — record the multi-daemon TUI behavior.

## Prerequisites

- Live daemons expose digest-keyed sockets that can be discovered without contacting non-daemon endpoints.
- Superseded daemons retain their sockets and serve observation and steering until their in-flight runs settle.
