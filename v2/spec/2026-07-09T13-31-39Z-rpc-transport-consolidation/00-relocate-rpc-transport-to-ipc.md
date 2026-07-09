# 00 - Relocate RPC transport to ipc/

## Problem

The correlated-RPC transport (`v2/src/tui/tui-daemon-rpc-transport.ts`) lives
under `tui/` even though it is not TUI-specific: `cli.ts` and
`daemon-lifecycle.ts` need the same request/reply multiplexing over
`IpcClient` and currently hand-roll their own loops instead. `ipc/` is already
the documented shared library domain (`v2/docs/v2-architecture.md` import
matrix: hosts may import `ipc/`; `ipc/` imports only `shared/`), so it's the
correct home before any other call site can consume the transport without
crossing a host-to-host boundary.

The two errors the transport throws (`TuiDaemonConnectionError`,
`TuiDaemonRpcError`, in `v2/src/tui/tui-daemon-errors.ts`) move with it: a
non-TUI caller (`cli.ts`, `daemon-lifecycle.ts`) catching a `Tui`-prefixed
error is the same domain leak as the transport itself living under `tui/`.
`TUI_DAEMON_SOCKET_DISPLAY` (an operator-facing display string used only by
TUI ink components) stays in `tui/tui-daemon-errors.ts`.

## Decisions

- Transport lands at `v2/src/ipc/rpc-transport.ts`, exporting
  `createRpcTransport` (renamed from `createTuiDaemonRpcTransport`) — matches
  the existing `ipc/` module naming, no `Tui` prefix on a shared symbol.
- Errors land at `v2/src/ipc/rpc-errors.ts` as `RpcConnectionError` and
  `RpcError` (renamed from `TuiDaemonConnectionError` /
  `TuiDaemonRpcError`) — same reasoning as the transport rename; `.code` on
  `RpcError` and constructor signatures are unchanged.
- `request()` gains an optional `timeoutMs` in its options bag
  (`{ trackWait?: boolean; timeoutMs?: number }`): when set, a pending
  request that hasn't resolved within `timeoutMs` is abandoned (reusing the
  existing `abandonRequest` path) and rejects with `RpcConnectionError` —
  needed by the bounded liveness probes in subspec 01; omitting it preserves
  today's unbounded wait.
- All existing TUI consumers (`tui-daemon-client.ts`, `tui-log-tail-client.ts`,
  `tui-ink-feedback.tsx`, `tui-ink-log-follow.tsx`, `tui-entry.tsx`, and their
  tests) update imports/names only — no behavior change in this subspec.

## Task checklist

- [ ] Move `tui/tui-daemon-rpc-transport.ts` → `ipc/rpc-transport.ts`; rename
      `createTuiDaemonRpcTransport` → `createRpcTransport`; add the
      `timeoutMs` option.
- [ ] Move `TuiDaemonConnectionError`/`TuiDaemonRpcError` out of
      `tui/tui-daemon-errors.ts` into `ipc/rpc-errors.ts`, renamed
      `RpcConnectionError`/`RpcError`; leave `TUI_DAEMON_SOCKET_DISPLAY` in
      `tui/tui-daemon-errors.ts`.
- [ ] Update every consumer's imports and error-class references to the new
      location/names (production code and tests).
- [ ] Update `export-surface-trim.test.ts`'s guard to point at
      `ipc/rpc-transport.ts` (the internal transport type must still not be
      exported).
- [ ] Update `v2/docs/v2-architecture.md` domain map: drop
      `tui-daemon-rpc-transport.ts` from the TUI host row; note
      `rpc-transport.ts` and `rpc-errors.ts` under the IPC transport row.

## Acceptance criteria

- [ ] `tui-daemon-client.test.ts` stays green (behavior unchanged by the move
      and rename).
- [ ] `tui-log-tail-client.test.ts` stays green.
- [ ] `tui-entry.test.tsx` and `tui-log-follow-entry.test.tsx` stay green.
- [ ] `export-surface-trim.test.ts` stays green against the relocated file.
- [ ] No file under `v2/src/tui/` exports or defines an RPC transport or RPC
      transport error class.

## Documentation updates

- `v2/docs/v2-architecture.md` domain map updated per the task checklist.
