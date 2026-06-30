# 00 — TUI daemon client

Reusable thin client over the production IPC socket for later TUI slices.
Proves `health` and `status` round-trips; surfaces transport failures without
run orchestration or UI rendering.

## Decisions

- Dedicated module for UI consumers — rules out inlining connect/RPC helpers only in the TUI entry command or `cli.ts`.
- Built on existing `connectIpcClient` transport — rules out a new wire stack or socket framing.
- Public surface exposes connect, `health`, `status`, and close minimum — rules out run-control RPCs (`start`, `list`, `wait`, streams) on this client in the scaffold slice.
- `socketPath` injectable; production default `~/.jarvis/daemon.sock` — rules out cwd-relative or implicit socket discovery in library code.
- Transport failures return a typed connection error to the caller — rules out `process.exit` or stderr writes inside the library layer.
- This slice does not refactor `cli.ts` — rules out drive-by extraction of CLI RPC helpers in the same PR.

## Task checklist

- Add a co-located client module under `v2/src` with injectable `connectIpcClient` seam.
- Implement connect → `health` → `{ ok: true }` and `status` → `{ state: "running" }` round-trips over one connection.
- Map socket connect failures and non-correlated/malformed RPC replies to the typed connection error.
- Default omitted `socketPath` to `~/.jarvis/daemon.sock`.
- Co-locate agent-runnable tests with injectable socket path and IPC client fake; socket-backed cases follow `v2/docs/test-writing.md` (`canUseUnixSockets`, `test.skipIf`).

## Acceptance criteria

- [ ] With an injectable socket path to a test IPC server, the client completes `health` and returns `{ ok: true }`.
- [ ] With an injectable socket path to a test IPC server, the client completes `status` and returns `{ state: "running" }`.
- [ ] When the socket path is unreachable, the client returns a typed connection error and does not send run-control RPCs.
- [ ] When the caller omits `socketPath`, the client targets `~/.jarvis/daemon.sock`.
- [ ] Co-located tests cover successful `health`/`status` round-trips and unreachable-socket failure with injectable paths and IPC fakes.

## Documentation updates

- No operator-facing doc updates — internal client surface only; exported symbols documented inline per [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
