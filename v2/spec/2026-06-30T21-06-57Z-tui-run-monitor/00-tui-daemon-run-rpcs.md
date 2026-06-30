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
- `list` returns `{ runs: Array<{ runId, project, branch, status, isLive }> }`
  per [`daemon-host.md`](../../docs/daemon-host.md) — rules out renaming fields
  or omitting `isLive`.
- `wait(runId)` blocks until the correlated `wait` response — rules out polling
  `list` or log streams to synthesize outcome.
- `wait` result shape matches daemon `WaitRunCompletionResult`: always
  `runStatus`; optional `loopOutcomeKind`, `iterationsConsumed`, `resumable`
  only when present — rules out `null` placeholders for omitted keys.
- Transport/wire failures reuse `TuiDaemonConnectionError`; correlated daemon
  `error` frames reuse `TuiDaemonRpcError` — rules out new error types for these
  RPCs.
- Injectable `connectIpcClient` seam preserved — rules out hard-wired production
  transport in tests.
- No operator-facing doc updates — internal client surface; inline doc-comments
  per [`documentation-standard.md`](../../docs/documentation-standard.md).

## Task checklist

- Extend `TuiDaemonClient` with `list()` and `wait(runId)`.
- Parse and validate `list`/`wait` success payloads; reject malformed replies as
  `TuiDaemonConnectionError`.
- Map correlated `error` frames (`invalid_params`, `unknown_run`, etc.) to
  `TuiDaemonRpcError`.
- Export typed row/result aliases aligned with daemon wire shapes.
- Co-locate agent-runnable tests with injectable IPC fakes; socket-backed cases
  follow [`test-writing.md`](../../docs/test-writing.md) (`canUseUnixSockets`,
  `test.skipIf`).
- Doc-comment every new exported symbol.

## Acceptance criteria

- [ ] With an injectable IPC fake, `list()` sends one `list` request and returns parsed runs including `runId`, `project`, `branch`, `status`, and `isLive` for each row.
- [ ] With an injectable IPC fake, `wait(runId)` sends one `wait` request with `{ runId }` and returns the parsed result with `runStatus` and only present optional fields.
- [ ] On an injectable IPC fake that defers the `wait` response, `wait(runId)` does not resolve until the simulated boundary reply arrives.
- [ ] When `list` or `wait` returns a correlated `error` frame, the client rejects with `TuiDaemonRpcError` (not `TuiDaemonConnectionError`).
- [ ] When `list` or `wait` returns a malformed success payload, the client rejects with `TuiDaemonConnectionError`.
- [ ] `health`, `status`, `list`, and `wait` on one open client reuse the same transport without reconnecting.
- [ ] Co-located tests inject a fake `connectIpcClient` and assert the client uses the injected transport.
- [ ] Co-located tests include socket-backed `list` and `wait` success cases registered with `test.skipIf(!canUseUnixSockets(), ...)`.
- [ ] Every new exported symbol in the client module has an inline doc-comment stating purpose, params, returns, and thrown errors.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- None — internal client surface; inline doc-comments only per
  [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
