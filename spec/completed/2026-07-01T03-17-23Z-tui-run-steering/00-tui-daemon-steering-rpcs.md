# 00 — TUI daemon steering RPCs

Extend `TuiDaemonClient` with `pause`, `resume`, and `kill` over the same IPC
connection. Reusable seam for run-monitor steering; no ink rendering.

## Prerequisites

- Merged TUI daemon run RPCs:
  `v2/spec/completed/2026-06-30T21-06-57Z-tui-run-monitor/00-tui-daemon-run-rpcs.md`.
- Daemon steering contract:
  `v2/docs/daemon-host.md` and
  `v2/spec/completed/2026-06-28T00-42-48Z-daemon-run-control-api/02-daemon-steering.md`.

## Decisions

- Add `pause`, `resume`, and `kill` to existing `TuiDaemonClient` — rules out a
  separate steering client or second socket.
- Each method sends wire params `{ runId }` and returns `{ ok: true }` on success
  per [`daemon-host.md`](../../docs/daemon-host.md) — rules out paramless steering
  or client-side status mutation without RPC.
- Correlated daemon `error` frames reject as `TuiDaemonRpcError` with pass-through
  `code`/`message` — rules out local reimplementation of daemon guards
  (`unknown_run`, `run_not_active`, `terminal_run`, `run_in_progress`,
  `worktree_claimed`, `invalid_params`).
- Transport/wire failures reuse `TuiDaemonConnectionError` — rules out new error
  types for steering RPCs.
- Steering RPCs multiplex on the same connection while `wait` is pending — rules
  out blocking the transport until `wait` resolves.
- Injectable `connectIpcClient` seam preserved — rules out hard-wired production
  transport in tests.
- No operator-facing doc updates — internal client surface; inline doc-comments
  per [`documentation-standard.md`](../../docs/documentation-standard.md).

## Task checklist

- Extend `TuiDaemonClient` with `pause(runId)`, `resume(runId)`, and
  `kill(runId)` returning `{ ok: true }`.
- Parse and validate success payloads; reject malformed replies as
  `TuiDaemonConnectionError`.
- Co-locate tests with injectable IPC fakes covering success, pinned per-method
  daemon error codes, and malformed payloads.
- Doc-comment every new exported symbol.

## Acceptance criteria

- [x] With an injectable IPC fake, `pause(runId)` sends one `pause` request with `{ runId }` and returns `{ ok: true }` on success.
- [x] With an injectable IPC fake, `resume(runId)` sends one `resume` request with `{ runId }` and returns `{ ok: true }` on success.
- [x] With an injectable IPC fake, `kill(runId)` sends one `kill` request with `{ runId }` and returns `{ ok: true }` on success.
- [x] When any steering RPC returns a correlated `error` frame, the client rejects with `TuiDaemonRpcError` carrying the daemon `code` and `message` (not `TuiDaemonConnectionError`).
- [x] When any steering RPC returns a malformed success payload, the client rejects with `TuiDaemonConnectionError`.
- [x] With an injectable IPC fake that defers `wait`, `pause`/`resume`/`kill` succeed on the same open client while `wait(runId)` is unresolved.
- [x] Co-located tests inject a fake `connectIpcClient` and assert steering methods use the injected transport.
- [x] Co-located fakes cover at least `unknown_run` plus one guard code per method family: `run_not_active` for `pause`/`kill`; `terminal_run` or `run_in_progress`/`worktree_claimed` for `resume`.
- [x] Every new exported symbol in the client module has an inline doc-comment stating purpose, params, returns, and thrown errors.
- [x] `TuiDaemonClient` inline doc-comment includes `pause`, `resume`, and `kill` in the export contract.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- None — internal client surface; inline doc-comments only per
  [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
