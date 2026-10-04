# 01 - Daemon operator session bootstrap

`startDaemon` (`v2/src/daemon/daemon.ts`) is the daemon's per-process
lifetime scope. Every run it executes flows through the single
`writeLoopExecutor` closure (`daemon.ts:947`) into `executeWriteLoop`. No
`operator_session_id` is minted or attached there today, so any run started
via the daemon (including runs dispatched over IPC from a CLI client) carries
no operator session tag.

## Decisions

- Mint with `crypto.randomUUID()` once inside `startDaemon`, before constructing `writeLoopExecutor` — one id for the whole daemon process lifetime, not per run or per IPC request.
- `writeLoopExecutor` applies the daemon's minted id to every `executeWriteLoop` call it makes, merging into (not overwriting) any `telemetry` fields already present on the incoming `input`. Rules out leaving it to individual IPC handlers, which would require repeating the merge at each call site.
- The daemon's id always wins for `operatorSessionId` specifically (even if a CLI client's `input.telemetry.operatorSessionId` is set) — the daemon, not the requesting CLI process, is the operator-sitting boundary for daemon-managed runs, per the intent's "covering every run/workflow it starts."

## Acceptance criteria

- [x] Two runs dispatched through one `startDaemon` call's `writeLoopExecutor` carry the same `operatorSessionId` in the `executeWriteLoop` input they receive.
- [x] A second, independent `startDaemon` call produces a different `operatorSessionId` than the first.
- [x] An `executeWriteLoop` input whose `telemetry.operatorSessionId` was already set by the caller is overridden with the daemon's id when routed through `writeLoopExecutor`.
- [x] Existing daemon lifecycle/wire tests (`daemon-lifecycle.test.ts`, `daemon-wire.test.ts`, `daemon-start-list.test.ts`) stay green.

## Documentation updates

- `v2/docs/telemetry-capture.md`: under "Operator session", note the daemon bootstrap point is implemented (`v2/src/daemon/daemon.ts` `startDaemon`), scoped to the daemon process lifetime, and that the daemon's minted id always overrides any caller-supplied `operatorSessionId` (override-wins precedence) — not just that the bootstrap point is implemented.
