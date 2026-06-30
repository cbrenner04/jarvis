# 00 — TUI run launch

Operator starts a detached write-loop run from `jarvis tui`: collect the same
launch inputs as `jarvis run start`, send one daemon IPC `start`, show the
returned run ID or admission-guard errors. Observation and steering stay out of
scope.

## Prerequisites

- Merged TUI scaffold:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/`.
- Daemon `start` RPC contract:
  `v2/docs/daemon-host.md` and
  `v2/spec/completed/2026-06-28T00-42-48Z-daemon-run-control-api/01-daemon-start-list.md`.

## Decisions

- Launch supersedes scaffold 01 connect-only exit-after-liveness and extends scaffold 00 client with `start` — rules out exiting `0` after `health`/`status` without field collection and `start`.
- Success path ordering: connect → `health` → IPC `status` → ink field collection → one `start` → view-host feedback → exit `0`.
- Retain `health`/`status` before field collection — rules out dropping liveness on the launch path and rules out liveness after `start`.
- Launch maps to daemon IPC `start` only — rules out foreground `executeWriteLoop` from the TUI.
- Required launch fields mirror `jarvis run start` / `jarvis write` (`--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--agents`, `--max-iterations`) — rules out a parallel TUI input schema.
- Extract shared `WriteLoopInput` builder from `jarvis run start` field mapping; TUI and CLI both call it — rules out optional "when practical" duplication and rules out divergent TUI/CLI payloads.
- Field collection via ink on the scaffold stack — rules out readline/stdout prompts.
- Extend `TuiDaemonClient` with `start` on the existing connection — rules out ad-hoc `connectIpcClient` / RPC helpers in the launch layer and rules out a second connect-only client type.
- Success, guard, validation, and RPC error feedback render through ink `TuiViewHost` — rules out stderr/stdout parity with `jarvis run start`.
- Extend `TuiViewState` beyond `connected | unavailable` for launch outcomes (success with run ID, guard failure, validation failure, RPC failure) — rules out connect-only view states; exact copy/layout deferred.
- Operator-visible success is the returned run ID via view host — rules out stdout run-ID scripting parity.
- Admission guards (`run_in_progress`, `worktree_claimed`) pass through as `TuiDaemonRpcError` and render as `<code>: <message>` via view host — rules out local reimplementation of daemon start guards.
- Generic `TuiDaemonRpcError` on `start` (non-guard codes) uses the same `<code>: <message>` view-host pass-through and exit `1` — rules out local reclassification.
- Missing/invalid required fields: exit `1`, no `start`, operator-visible errors via view host — rules out sending partial `start` params.
- `health`/`status` RPC failure after connect: `<code>: <message>` via view host, exit `1` — rules out silent throw/rethrow.
- Connect-time or mid-flow `TuiDaemonConnectionError` (including during `start`): reuse scaffold unavailable-daemon view state and exit `1` — rules out distinct "connection lost" copy in this slice.
- Launch slice RPC surface: connect scaffolding (`health`, `status`) plus one `start` — rules out `list`, `wait`, log streams, `pause`, `resume`, and `kill`.
- Foreground `jarvis write` and `jarvis run` hosts stay — rules out TUI-only or daemon-only entry replacing them.
- Co-located tests inject daemon client and view host — rules out live-terminal-only automated coverage.
- Deferred to first consumer: form layout, validation UX copy, operator cancel/abort path — pin in refine.
- Deferred to first consumer: post-launch session behavior after showing run ID (exit vs persist for monitor) — pin in monitor slice or refine.

## Task checklist

- Extend `v2/src/tui-daemon-client.ts` with `start(input: WriteLoopInput)` returning `{ runId: string }`; correlated daemon `error` frames reject as `TuiDaemonRpcError`; doc-comment per `documentation-standard.md`.
- Add co-located client tests for successful `start`, admission guards, and generic RPC errors with injectable IPC transport.
- Extract shared `WriteLoopInput` builder from `jarvis run start` mapping; wire TUI field collection through it without changing foreground `jarvis write` behavior.
- Evolve `jarvis tui`: connect → `health` → IPC `status` → ink field collection → `start` → view-host feedback.
- Extend `TuiViewState` / view host for launch outcomes; render all operator feedback through ink (production) or injectable view host (tests).
- Success path: view host records returned run ID; exit `0`.
- Guard and generic RPC-error paths: view host shows `<code>: <message>`; exit `1`.
- Validation path: view host shows operator-visible field errors; exit `1`; no `start`.
- Unavailable-daemon and mid-flow connection-loss paths: preserve scaffold unavailable feedback; exit `1`.
- Do not invoke `list`, `wait`, log streams, `pause`, `resume`, or `kill`.
- Co-locate launch-flow tests with injectable daemon client, field collector, and view-host fakes.
- Update `tui-entry.test.tsx` expectations for launch supersession of connect-only flow.
- Revise durable operator docs per Documentation updates.

## Acceptance criteria

- [x] `TuiDaemonClient.start` sends one correlated IPC `start` request carrying `WriteLoopInput` and returns `{ runId }` on success.
- [x] `TuiDaemonClient.start` rejects `run_in_progress`, `worktree_claimed`, and other daemon `error` frames as `TuiDaemonRpcError` without local guard logic.
- [x] Every exported symbol added or changed on `TuiDaemonClient` for `start` has an inline doc-comment per `v2/docs/documentation-standard.md` (mirror scaffold 00).
- [x] For a fixed field fixture (required fields plus omitted optional flags), the shared builder produces the same `WriteLoopInput` whether invoked from `jarvis run start` argv mapping or the TUI field collector seam.
- [x] When the daemon is reachable, `jarvis tui` runs `health` then IPC `status`, collects launch fields via ink, sends one `start` with matching `WriteLoopInput`, and does not call `executeWriteLoop` locally.
- [x] On successful `start`, the injectable view host records a launch-success state including the returned run ID and `jarvis tui` exits `0`.
- [x] On daemon `run_in_progress` or `worktree_claimed`, the view host records `<code>: <message>`, `jarvis tui` exits `1`, and no local guard logic runs.
- [x] On other `TuiDaemonRpcError` from `start`, the view host records `<code>: <message>` and `jarvis tui` exits `1`.
- [x] On `TuiDaemonRpcError` from `health` or IPC `status` after connect, the view host records `<code>: <message>` and `jarvis tui` exits `1`.
- [x] On missing or invalid required launch fields, the view host records a validation-failure state, `jarvis tui` exits `1`, and does not send `start`.
- [x] When the daemon socket is unreachable at connect or `TuiDaemonConnectionError` occurs before or during `start`, `jarvis tui` records scaffold unavailable-daemon feedback (names `~/.jarvis/daemon.sock`, mentions `jarvis daemon start`) and exits `1`.
- [x] `jarvis tui` does not invoke `list`, `wait`, log streams, `pause`, `resume`, or `kill`.
- [x] Co-located tests cover `TuiDaemonClient.start` success, both admission guards, and a generic RPC error with injectable IPC fakes.
- [x] Co-located tests cover launch-flow success, both admission guards, validation failure, generic `start` RPC error, liveness RPC error, and unavailable daemon with injectable daemon client, field collector, and view-host fakes.
- [x] `v2/src/tui-entry.test.tsx` stays green with expectations updated for launch flow (supersedes connect-only `health`/`status`-then-exit contract).
- [x] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [x] `v2/docs/write-behavior.md` `jarvis tui` row is revised for launch: field contract (same as `jarvis run start`), ink feedback for run ID on success, guard/validation/RPC errors as `<code>: <message>`, exit codes (`0` success, `1` validation/guard/RPC/unavailable).
- [x] `v2/docs/v2-architecture.md` shipped TUI bullet records connect → liveness → launch via IPC `start`; monitor and steer remain sibling work.
- [x] `v2/docs/daemon-host.md` cross-links `jarvis tui` as a consumer of IPC `start` over the production socket.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — revise `jarvis tui` table row for launch outcomes (field contract, ink run-ID success, guard/validation/RPC errors, exit codes); cross-link `jarvis run start` input mapping.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — revise shipped TUI bullet: connect, liveness (`health`/`status`), launch via IPC `start`; cross-link `write-behavior.md#tui-cli`.
- [`v2/docs/daemon-host.md`](../../docs/daemon-host.md) — cross-link `jarvis tui` as IPC `start` consumer (scaffold pattern for socket-default caller).
