---
name: jarvis-path-constants-consolidation
---

# Consolidate ~/.jarvis path constants

## Problem

`~/.jarvis/*` paths are redefined at each use site instead of sourced from
one place: `daemon.sock` in `v2/src/cli.ts:49`,
`v2/src/tui/tui-log-tail-client.ts:35`, and
`v2/src/tui/tui-daemon-client.ts:78`; the matching display string
`TUI_DAEMON_SOCKET_DISPLAY` in `v2/src/tui/tui-daemon-errors.ts:2`; plus
`daemon.pid` and `config.json` (`cli.ts:50-51`,
`config/machine-config-loader.ts:6,54,64`). A path typo in one site would
silently diverge from the others.

## Direction

One `paths.ts` module exporting the `~/.jarvis` path constants (and the
matching display string); every call site imports from it.

## Decisions

- Single module covers `daemon.sock`, `daemon.pid`, `config.json`, and the
  socket display string — rules out a partial dedup that leaves any of these
  redefined locally.

## Prerequisites
