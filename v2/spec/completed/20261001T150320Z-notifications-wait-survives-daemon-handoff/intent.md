---
name: notifications-wait-survives-daemon-handoff
---

# Notifications wait survives daemon handoff

Unsplit rationale: the seed changes only the CLI `notifications wait` loop and its co-located tests; daemon RPCs, IPC transport, and the `notification_list` subcommand stay unchanged, so there is one module-boundary surface.

## Problem

`waitForIncident` blocks on `notification_wait` over one IPC client. When the daemon self-hands-off after a merge, the connection closes, `RpcConnectionError("IPC connection lost")` is not an `RpcError`, and `requestOrReport` rethrows it: the CLI exits 1 and the operator's wake path is gone until re-armed by hand.

## Decisions

- On connection loss (not an RPC refusal), `waitForIncident` reconnects to the stable socket and retries the RPC that failed — every `notification_wait` and in-loop `notification_list` on the `--project` catch-up path — with the loop’s current `params` (initial `--since` or the latest scanned cursor); no incident is skipped or duplicated.
- Reconnect is bounded (backoff, e.g. up to ~2 min total); when the budget is exhausted, exit `1` and write stderr the last connection-loss message (`IPC connection lost`, same text as today’s uncaught `RpcConnectionError` path). RPC error frames keep today’s immediate exit `1` via `formatRpcError`.
- `jarvis notifications list` stays one-shot (no reconnect loop).

## Acceptance criteria

- [ ] `v2/src/commands/notifications.test.ts`: a wait whose first connection closes mid-`notification_wait` reconnects and returns the incident served by a second fake daemon, using the same `sinceCursor`; fails pre-fix (exits 1 with `IPC connection lost`).
- [ ] Same file: a `--project` wait whose first connection closes mid-`notification_list` catch-up reconnects and returns the matching incident without advancing past it; fails pre-fix.
- [ ] Same file: when every reconnect attempt fails, the wait exits 1 after the bound with stderr `IPC connection lost`; an `RpcError` frame still exits 1 immediately (new preservation test — passes on pre-fix, not a failing-test AC for handoff).
- [ ] `bun run typecheck`, `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Operator notifications — wait survives daemon handoff (reconnect, bounded failure stderr).
- `v2/docs/v1-behaviors.md` — **[v2 behavior change]** `jarvis notifications wait` reconnects on IPC connection loss during `waitForIncident` (including `--project` catch-up `notification_list`), with bounded backoff, then exits `1` with `IPC connection lost` on exhaustion; `jarvis notifications list` unchanged.

## Primary implementation surface

v2/src/commands/notifications.ts

## Prerequisites
