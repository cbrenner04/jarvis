---
name: retire-tui-daemon-client-start
---

# Retire dead `TuiDaemonClient.start`

## Prerequisites

## Problem

`TuiDaemonClient.start` (`tui-daemon-client.ts`) is exercised only by its own unit tests. The TUI `start` verb admits pipelines through pipeline admission, not this RPC wrapper.

## Behavior

Remove `start` from the `TuiDaemonClient` type and `connectTuiDaemon` implementation. Delete or rewrite client tests that called `client.start`. TUI pipeline start admission is unchanged.

## Decision ledger

- Delete only the TUI RPC client `start` method; rules out removing the daemon IPC `start` handler still used by `jarvis run start` and workflow admission.
- Leave TUI pipeline admission untouched; rules out rerouting TUI start through the removed client method.

## Acceptance criteria

- [ ] `TuiDaemonClient` has no `start` member; `tui-daemon-client.test.ts` no longer exercises `client.start`; the typecheck fails against the pre-fix export.
- [ ] `v2/src/commands/tui.test.ts` TUI start admission tests stay green (pipeline admission unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — dead test-only RPC surface with no operator docs.
