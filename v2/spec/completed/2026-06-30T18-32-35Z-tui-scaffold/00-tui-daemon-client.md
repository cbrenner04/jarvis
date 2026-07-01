# 00 — TUI daemon client

Reusable thin client over the production IPC socket for later TUI slices.
Proves `health` and `status` round-trips; surfaces transport failures without
run orchestration or UI rendering.

## Decisions

- Dedicated module for UI consumers — rules out inlining connect/RPC helpers only in the TUI entry command or `cli.ts`.
- Built on existing `connectIpcClient` transport — rules out a new wire stack or socket framing.
- Public surface exposes connect, `health`, `status`, and close minimum — rules out run-control RPCs (`start`, `list`, `wait`, streams) on this client in the scaffold slice.
- `socketPath` injectable; production default `~/.jarvis/daemon.sock` — rules out cwd-relative or implicit socket discovery in library code.
- `TuiDaemonConnectionError` (`Error` subclass) for transport/connect failures: socket unreachable, connect rejection, malformed frames, and non-correlated RPC replies — rules out `process.exit`, stderr writes, or plain `Error` throws in the library layer.
- Daemon `error` RPC frames on `health`/`status` reject as `TuiDaemonRpcError` (`code`, `message` from frame) — rules out folding RPC semantic failures into `TuiDaemonConnectionError` (CLI separates these via `formatConnectionError` vs `formatRpcError` in `cli.ts`).
- This slice does not refactor `cli.ts` — rules out drive-by extraction of CLI RPC helpers in the same PR.

## Task checklist

- Add a co-located client module under `v2/src` with injectable `connectIpcClient` seam.
- Implement connect → `health` → `{ ok: true }` and `status` → `{ state: "running" }` round-trips over one connection.
- Map socket connect failures and non-correlated/malformed RPC replies to `TuiDaemonConnectionError`; map correlated `error` frames to `TuiDaemonRpcError`.
- Default omitted `socketPath` to `~/.jarvis/daemon.sock`.
- Co-locate agent-runnable tests with injectable socket path and IPC client fake; socket-backed cases follow `v2/docs/test-writing.md` (`canUseUnixSockets`, `test.skipIf`).
- Doc-comment every exported symbol per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [x] With an injectable socket path to a test IPC server, the client completes `health` and returns `{ ok: true }`.
- [x] With an injectable socket path to a test IPC server, the client completes `status` and returns `{ state: "running" }`.
- [x] `health` then `status` on one open connection reuse the same transport without reconnecting.
- [x] When the socket path is unreachable, the client rejects with `TuiDaemonConnectionError` and does not send run-control RPCs.
- [x] When the peer returns a malformed or non-correlated RPC reply, the client rejects with `TuiDaemonConnectionError`.
- [x] When connect succeeds but `health` or `status` returns a correlated `error` frame, the client rejects with `TuiDaemonRpcError` (not `TuiDaemonConnectionError`).
- [x] When the caller omits `socketPath`, the client targets `~/.jarvis/daemon.sock`.
- [x] Co-located tests inject a fake `connectIpcClient` and assert the client uses the injected transport (not production `connectIpcClient`).
- [x] Co-located tests include socket-backed success and unreachable-socket cases registered with `test.skipIf(!canUseUnixSockets(), ...)`.
- [x] Every exported symbol in the client module has an inline doc-comment stating purpose, params, returns, and thrown errors.

## Documentation updates

- No operator-facing doc updates — internal client surface only; exported symbols documented inline per [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
