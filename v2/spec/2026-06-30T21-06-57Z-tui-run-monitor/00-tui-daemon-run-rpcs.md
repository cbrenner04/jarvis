# 00 — TUI daemon run RPCs

Extend the 00 TUI daemon client with `list` and `wait` over the same IPC
connection. Reusable seam for the run monitor and later TUI slices; no ink
rendering.

## Prerequisites

- Merged TUI daemon client scaffold:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/00-tui-daemon-client.md`.

## Decisions

- Add `list` and `wait` to the existing `TuiDaemonClient` — rules out a
  separate run-control client type or second socket connection.
- Multiplex concurrent in-flight RPCs on one connection by request `id` per
  [`daemon-host.md`](../../docs/daemon-host.md) — rules out scaffold
  single-outstanding-request model that rejects non-correlated replies while
  another RPC is pending.
- `list()` completes while `wait(runId)` is pending on the same socket — rules out
  blocking the transport until `wait` resolves.
- `list` returns `{ runs: Array<{ runId, project, branch, status, isLive }> }`
  per [`daemon-host.md`](../../docs/daemon-host.md) — rules out renaming fields
  or omitting `isLive`.
- `wait(runId)` sends wire params `{ runId }` and blocks until the correlated
  `wait` response — rules out paramless `wait` and polling `list` or log streams
  to synthesize outcome.
- Reuse `WaitRunCompletionResult` from `daemon.ts` for `wait` return type — rules
  out a parallel TUI-only result alias.
- `wait` result: always `runStatus`; optional `loopOutcomeKind`, `iterationsConsumed`,
  `resumable` only when present — rules out `null` placeholders for omitted keys.
- Client-side `wait` abandonment ignores late correlated replies (track request
  `id` / abandonment token) — rules out resolving stale promises after abandon.
- Transport/wire failures reuse `TuiDaemonConnectionError`; correlated daemon
  `error` frames reuse `TuiDaemonRpcError` — rules out new error types for these
  RPCs.
- Injectable `connectIpcClient` seam preserved — rules out hard-wired production
  transport in tests.
- No operator-facing doc updates — internal client surface; inline doc-comments
  per [`documentation-standard.md`](../../docs/documentation-standard.md).

## Task checklist

- Extend correlation to multiplex concurrent in-flight RPCs on one connection.
- Extend `TuiDaemonClient` with `list()` and `wait(runId)`.
- Parse and validate `list`/`wait` success payloads; reject malformed replies as
  `TuiDaemonConnectionError`.
- Map correlated `error` frames (`invalid_params`, `unknown_run`, etc.) to
  `TuiDaemonRpcError`.
- Reuse `WaitRunCompletionResult` from `daemon.ts`; export list row alias aligned
  with wire shape.
- Co-locate agent-runnable tests with injectable IPC fakes; socket-backed cases
  follow [`test-writing.md`](../../docs/test-writing.md) (`canUseUnixSockets`,
  `test.skipIf`).
- Doc-comment every new exported symbol.

## Acceptance criteria

- [x] With an injectable IPC fake, `list()` sends one `list` request and returns parsed runs including `runId`, `project`, `branch`, `status`, and `isLive` for each row.
- [x] With an injectable IPC fake, `wait(runId)` sends one `wait` request with `{ runId }` and returns the parsed result with `runStatus` and only present optional fields.
- [x] On an injectable IPC fake that defers the `wait` response, `wait(runId)` does not resolve until the simulated boundary reply arrives.
- [x] With an injectable IPC fake that defers `wait`, `list()` succeeds and returns parsed runs while `wait(runId)` is unresolved on the same client.
- [x] When a client-abandoned `wait` receives a late correlated reply, the abandoned promise does not resolve.
- [x] When `list` or `wait` returns a correlated `error` frame, the client rejects with `TuiDaemonRpcError` (not `TuiDaemonConnectionError`).
- [x] When `list` or `wait` returns a malformed success payload, the client rejects with `TuiDaemonConnectionError`.
- [x] `health`, `status`, `list`, and `wait` on one open client reuse the same transport without reconnecting.
- [x] Co-located tests inject a fake `connectIpcClient` and assert the client uses the injected transport.
- [x] Co-located tests include socket-backed `list` and `wait` success cases registered with `test.skipIf(!canUseUnixSockets(), ...)`.
- [x] Co-located socket-backed tests include `list()` succeeding while `wait(runId)` is pending on the same connection (`test.skipIf(!canUseUnixSockets(), ...)`).
- [x] Every new exported symbol in the client module has an inline doc-comment stating purpose, params, returns, and thrown errors.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- None — internal client surface; inline doc-comments only per
  [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).

## Blocker

- `bun run typecheck` passes.
- `bun run test` did not pass in this worktree. The parallel run surfaced unrelated v1 sandbox/network failures including `v1/test/idle-hang-fixtures.sandbox-unrunnable.test.ts` (`no processes matching .../idle-hang.sh within 2000ms`) and `v1/test/ready-script.sandbox-unrunnable.test.ts` (`ready: serial test failed (code 2)`), then stalled. Per repo rule, a serial retry was started with `bun test`; it reproduced `ready: serial test failed (code 2)` and did not complete cleanly.
