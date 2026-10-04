---
name: rpc-transport-consolidation
---

# Consolidate hand-rolled RPC frame loops onto one transport

## Problem

Three call sites hand-roll their own RPC frame loop instead of sharing one:
`cli.ts` `request()` (`v2/src/cli.ts:385`, including the 24h
`LOG_FRAME_WAIT_MS = 86_400_000` wait hack at line 61/314), the daemon-lifecycle
`probeSocket` (`v2/src/daemon/daemon-lifecycle.ts:42`), and
`v2/src/tui/tui-daemon-rpc-transport.ts`. The canonical transport currently
lives under `tui/` even though `cli.ts` and `daemon-lifecycle.ts` are not TUI
code.

## Direction

Relocate the RPC transport out of `tui/` to a shared location; `cli.ts`
`request()`, `probeSocket`, and the TUI daemon client all consume the one
transport. Drop the `LOG_FRAME_WAIT_MS` hack in favor of the transport's
normal frame-wait handling.

## Decisions

- Transport moves out of `tui/` into a shared module — rules out leaving it
  under `tui/` and importing across a domain boundary from `cli.ts`/
  `daemon-lifecycle.ts`.
- `LOG_FRAME_WAIT_MS`'s 24h wait is a workaround for the ad-hoc loop, not a
  requirement of RPC framing itself — dropped once the shared transport
  handles waiting.

## Documentation updates

- `v2/docs/v2-architecture.md` domain map — update if the transport
  relocation crosses documented domain boundaries.

## Prerequisites
