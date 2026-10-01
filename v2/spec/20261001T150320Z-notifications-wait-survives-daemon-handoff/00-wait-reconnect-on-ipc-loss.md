# Wait reconnect on IPC loss

## Problem

`waitForIncident` (`v2/src/commands/notifications.ts`) loops on `notification_wait` and, when `--project` filters a wake, on in-loop `notification_list` catch-up — all over one `IpcClient` from `withConnectDispatch`. Daemon self-handoff after a merge closes the socket; `request` surfaces `RpcConnectionError("IPC connection lost")` (`v2/src/ipc/rpc-transport.ts`), which is not an `RpcError`, so `requestOrReport` rethrows and `withConnectDispatch` prints `IPC connection lost\n` via `formatConnectionError` and exits `1`. Reachable in production when `jarvis notifications wait` blocks across a handoff (operator reports, 2026-10-01).

## Decisions

- On `RpcConnectionError` only, retry the same RPC that failed (`notification_wait` or in-loop `notification_list`) after a fresh `deps.connectIpcClient(deps.socketPath)` — rules out treating transport loss like `RpcError` (immediate exit) and rules out restarting the whole wait loop from scratch (would risk skip/duplicate semantics).
- Each retry uses the loop's current `params` (`sinceMs` / `sinceCursor` / `kinds` as already advanced by project catch-up) — rules out re-parsing argv or resetting to initial `--since` on reconnect.
- Reconnect attempts use injected `deps.now` and `deps.sleep` with a fixed total budget of ~120s wall time before giving up — rules out unbounded retry and rules out failing on the first disconnect without retry; exact step schedule is implementer choice within that budget.
- Failed `connectIpcClient` during the reconnect loop consume the same ~120s budget via `deps.now`/`deps.sleep` backoff; the retried RPC runs only after a successful connect — rules out counting connect failures separately from RPC-loss retries and rules out attempting RPC on a dead client.
- After budget exhaustion (RPC loss with no successful reconnect, or connect never succeeding within budget), exit `1` and stderr `IPC connection lost\n` (same message string as today's uncaught `RpcConnectionError` through `withConnectDispatch`) — rules out a new error token or exit `0`.
- `RpcError` frames from the daemon still exit `1` immediately through `requestOrReport` + `formatRpcError` with no reconnect — rules out retrying RPC refusals.
- `notificationRpc` for `notification_list` and all daemon RPC handlers stay unchanged — rules out reconnect inside one-shot list or daemon-side wait state.
- Reconnect logic lives in `waitForIncident` (or helpers colocated in `notifications.ts`); `withConnectDispatch` stays a single connect for the command invocation — rules out pushing reconnect into generic dispatch for every CLI verb.

## Task checklist

- [ ] Add a connection-loss path in `waitForIncident` that catches `RpcConnectionError` from `request` (not from `requestOrReport`'s `RpcError` branch), reconnects via `deps.connectIpcClient`, and re-issues the failing method with unchanged `params` until success or reconnect budget exhaustion.
- [ ] Thread `CliDeps` (at least `connectIpcClient`, `socketPath`, `now`, `sleep`) into `waitForIncident` from `notificationRpc` without changing `notifications list` behavior.
- [ ] Add `notifications.test.ts` regression: first fake client closes mid-`notification_wait`, second client serves the owed incident; assert same `sinceCursor` on the retried wait and exit `0` with expected stdout — fails pre-fix (`IPC connection lost`, exit `1`).
- [ ] Add `notifications.test.ts` regression: `--project` wait where first client dies mid in-loop `notification_list` after a non-matching `notification_wait`; second client completes catch-up and returns the matching incident without skipping it — fails pre-fix.
- [ ] Add `notifications.test.ts` regression: after first mid-RPC disconnect, every `connectIpcClient` fails; drive exhaustion with injected `deps.now`/`deps.sleep` (no wall-clock ~120s wait) until budget elapses; assert multiple post-loss `connectIpcClient` calls, advancing fake time across backoff, then exit `1` and stderr `IPC connection lost\n` — fails pre-fix (single connect, immediate exit `1`).
- [ ] Add `notifications.test.ts` preservation: `RpcError` on `notification_wait` still exits `1` immediately with `formatRpcError` stderr (passes on pre-fix).
- [ ] Update `v2/docs/operator-runbook.md` § Operator notifications (correct `--project` wait catch-up: in-loop `notification_list` plus `notification_wait`, not wait-only) and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [x] `notifications.test.ts` `notification_wait` reconnect regression: first connection lost mid-wait, second fake daemon returns the owed incident with the same `sinceCursor` on the retried RPC; fails against pre-fix code (exit `1`, stderr `IPC connection lost`).
- [x] `notifications.test.ts` `--project` catch-up regression: first connection lost mid in-loop `notification_list`, reconnect returns the matching project incident without advancing past it; fails against pre-fix code.
- [x] `notifications.test.ts` reconnect exhaustion regression: after mid-RPC disconnect, repeated failed `connectIpcClient` with injected `deps.now`/`deps.sleep` advancing through the reconnect budget, observable as multiple post-loss connect attempts before exit `1` with stderr `IPC connection lost\n`; fails against pre-fix code (no post-loss reconnect loop).
- [x] `notifications.test.ts` RpcError preservation during wait: daemon error frame exits `1` immediately via `formatRpcError` with no reconnect loop (passes on pre-fix; not the handoff failing-test AC).
- [x] `notifications.test.ts` `notifications list since duration returns prior ledger incidents` stays green (list stays one-shot; no reconnect loop).
- [x] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Operator notifications — correct `--project` wait semantics (catch-up uses in-loop `notification_list`, not only repeated `notification_wait`); document that `jarvis notifications wait` reconnects on IPC connection loss during blocking wait (including that catch-up path), with bounded backoff, then exits `1` with `IPC connection lost` when reconnect is exhausted; `jarvis notifications list` remains one-shot.
- [ ] `v2/docs/v1-behaviors.md` — **[v2 behavior change]** bullet: `jarvis notifications wait` reconnects on IPC connection loss inside `waitForIncident` (including `--project` catch-up `notification_list`), bounded backoff, then exit `1` with `IPC connection lost` on exhaustion; `jarvis notifications list` unchanged.
