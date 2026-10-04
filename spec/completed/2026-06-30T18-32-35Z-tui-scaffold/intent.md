---
name: tui-scaffold
---

# TUI scaffold and daemon client

First interactive v2 client: a terminal UI entry command that connects to the running daemon over the production IPC socket. No run orchestration — prove connect, health, and clear operator feedback when the daemon is unavailable.

Source: Phase 4 in `v2/docs/v2-build-order.md` and Interface in `v2/docs/v2-architecture.md`. Done condition is merged code in `v2/src`, not this intent.

## Scope

- TUI entry command (exact name pinned in refine).
- Reusable daemon IPC client for later TUI slices (health/status round-trip minimum).
- Connection UX: connected vs unavailable daemon; no local orchestration logic.
- Co-located tests with injectable socket path.

## Out of scope

- Launching, listing, tailing, or steering runs (sibling intents).
- Workflow presets, natural-language router, PR lifecycle.
- Changing daemon server or `executeWriteLoop` semantics.

## Decisions

- TUI is a thin daemon IPC client — rules out embedding run guards or loop logic in the UI layer.
- Foreground `jarvis write` and `jarvis run` CLI hosts stay — rules out daemon-only entry.
- Deferred to first consumer: blessed terminal UI library — pin in refine.
- Deferred to first consumer: entry command name and top-level command tree placement — pin in refine.

## Documentation updates

- `v2/docs/v2-architecture.md` Interface — record TUI as the first UI client once entry and connect behavior ship.
- Operator-facing v2 doc home (likely cross-link from `v2/docs/write-behavior.md`) — document TUI entry and daemon-unavailable errors once command name settles.

## Prerequisites

- Long-running daemon with typed IPC transport and start/stop/status lifecycle
- Production daemon socket path pinned at `~/.jarvis/daemon.sock` by the thin CLI control surface
- Daemon IPC `health` RPC proves channel liveness
