---
name: tui-daemon-client-trim-socket-roundtrips
---
# Tui Daemon Client Trim Socket Roundtrips

# Drop redundant socket round-trips from tui-daemon-client.test.ts

`v2/src/tui/tui-daemon-client.test.ts` includes `socketTest` round-trip cases that
duplicate transport and daemon behavior already owned by the ipc and daemon test suites.

## Decisions

- Remove the `socketTest` round-trip cases from `tui-daemon-client.test.ts`, keeping only
  "rejects unreachable socket".

## Out of scope

- Consolidating the fake IpcClient / fixed-uuid helpers (separate intent).
- Any change to daemon or ipc test files.

## Verification

`tui-daemon-client.test.ts` retains exactly one `socketTest` case ("rejects unreachable
socket"); all other coverage in the file is unchanged.

## Prerequisites
