# Retire TuiDaemonClient.start

## Problem

- `TuiDaemonClient.start` in `v2/src/tui/tui-daemon-client.ts` is exercised only by `tui-daemon-client.test.ts`; production TUI detached start admits pipelines through `admitDetachedPipelineStart` / `pipeline_start`, not this RPC wrapper.

## Behavior

- Remove `start` from the `TuiDaemonClient` type and `connectTuiDaemon` return value; delete start-only imports, types, and doc-comment mentions.
- Delete or rewrite `tui-daemon-client.test.ts` coverage that calls `client.start`; drop `START_INPUT` / `START_REQUEST_ID` when unused.
- Remove `start` stubs from `TuiDaemonClient` test fakes that exist only to satisfy the type.
- Daemon IPC `start` handling and TUI pipeline admission stay unchanged.

## Decision ledger

- Delete only the TUI RPC client `start` method; rules out removing the daemon IPC `start` handler still used by `jarvis run start` and workflow admission.
- Leave TUI pipeline admission untouched; rules out rerouting TUI detached start through the removed client method.
- Substitute `resume` as the third RPC representative in `daemon error replies reject as RpcError with code and message`; rules out an unspecified steering RPC or deleting that cross-method error-mapping pin.
- Correct `v2/docs/daemon-host.md` socket-path IPC `start` consumer claim for TUI (dock `start` admits via `pipeline_start`, not IPC `start`); rules out leaving the pre-existing contradiction unrecorded.

## Tasks

- Remove `start` from `TuiDaemonClient`, the `connectTuiDaemon` implementation, and start-only helpers (`TuiDaemonStartResult`, `WriteLoopInput` / `parseStartResult` imports when unused); update type and `connectTuiDaemon` doc comments that still list `start`.
- Delete test `start sends one correlated IPC start request and returns runId`; rewrite `daemon error replies reject as RpcError with code and message` to use `resume` instead of `client.start` for the third representative and update the stale comment that references the "revision-gated start path".
- Add a compile-time regression in `tui-daemon-client.test.ts` proving `start` is not callable on `TuiDaemonClient`.
- Drop `start` from `healthyTuiDaemonClient` in `v2/src/commands/tui.test.ts`, `fakeClient` and the inline `TuiDaemonClient` literal in `v2/src/tui/tui-entry.test.tsx`, `fakeClient` in `v2/src/tui/tui-monitor-terminal-window.test.ts`, and `makeMockDaemon` in `v2/src/tui/tui-log-follow-entry.test.tsx`.
- Correct `v2/docs/daemon-host.md` socket-path bullet: TUI monitor uses the production socket; dock `start` admits via `pipeline_start`, not IPC `start`.

## Acceptance criteria

- [x] `v2/src/tui/tui-daemon-client.ts` exports `TuiDaemonClient` with no `start` member and `connectTuiDaemon` with no `start` implementation; a compile-time `@ts-expect-error` (or equivalent) on `client.start(...)` fails against the pre-fix export reachable in that module.
- [x] `v2/src/tui/tui-daemon-client.test.ts` no longer calls `client.start`; test `start sends one correlated IPC start request and returns runId` is absent; the compile-time `start`-absence regression fails against the pre-fix tests reachable in that file; `daemon error replies reject as RpcError with code and message` stays green.
- [x] `v2/src/commands/tui.test.ts` — `healthyTuiDaemonClient` omits `start` (typecheck fails against the pre-fix stub reachable in that file) and test `jarvis tui supplies monitor controls whose detached admission uses pipeline start seams` stays green.
- [x] `v2/src/tui/tui-entry.test.tsx` `fakeClient` and the single inline `TuiDaemonClient` literal omit `start`; typecheck fails against the pre-fix stubs reachable in that file.
- [x] `v2/src/tui/tui-monitor-terminal-window.test.ts` `fakeClient` omits `start`; typecheck fails against the pre-fix stub reachable in that file.
- [x] `v2/src/tui/tui-log-follow-entry.test.tsx` `makeMockDaemon` omits `start`; typecheck fails against the pre-fix stub reachable in that file.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — socket-path bullet: TUI monitor connects over the production socket; dock `start` admits via `pipeline_start`, not IPC `start`.
