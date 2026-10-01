---
name: notifications-wait-survives-daemon-handoff
---

# notifications wait survives a daemon handoff

## Problem

`waitForIncident` (`v2/src/commands/notifications.ts`) blocks on `notification_wait` over one IPC client. When the daemon self-hands-off after a merge, the connection closes, `RpcConnectionError("IPC connection lost")` (`v2/src/ipc/rpc-transport.ts`) is not an `RpcError`, and `requestOrReport` rethrows it: the CLI exits 1 and the operator's wake path is gone until re-armed by hand.

## Evidence

- 2026-10-01: `jarvis notifications wait --project jarvis` died with `IPC connection lost` three times in one session, each right after a `v2/src` merge rotated the daemon; the operator had to wrap it in a retry loop.

## Decisions

- On a connection loss (not an RPC refusal), the wait reconnects to the stable socket and re-issues `notification_wait` with the last delivery cursor it holds (initial `--since` or the latest scanned cursor); no incident is skipped or duplicated.
- Reconnect is bounded (backoff, e.g. up to ~2 min total) and then exits 1 with the existing message; RPC error frames keep today's behavior.
- `notification_list` is unchanged (one-shot).

## Acceptance criteria

- [ ] `v2/src/commands/notifications.test.ts`: a wait whose first connection closes mid-request reconnects and returns the incident served by a second fake daemon, using the same `sinceCursor`; fails pre-fix (exits 1 with `IPC connection lost`).
- [ ] Same file: when every reconnect attempt fails, the wait exits 1 after the bound; an `RpcError` frame still exits 1 immediately.
- [ ] `bun run typecheck`, `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Operator notifications — wait survives daemon handoff.
