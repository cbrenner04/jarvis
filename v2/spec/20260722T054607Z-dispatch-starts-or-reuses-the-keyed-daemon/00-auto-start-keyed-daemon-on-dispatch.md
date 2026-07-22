# Auto-start the keyed daemon on dispatch

`withAutoBounceDispatch` (`v2/src/cli/stale-dispatch.ts`) opens with
`deps.connectIpcClient(deps.socketPath)` and reports a lifecycle error when nothing
is listening. Now that the socket is keyed by executable digest, that is the normal
state of a fresh checkout: no operator has ever started *that* daemon. Two CLIs on
the same digest can also start it at once, and the loser gets
`DaemonAlreadyRunningError` from `startDaemon`.

## Decisions

- Auto-start inside `withAutoBounceDispatch`, so every mutating dispatch (`run`, `run workflow`) inherits it; rules out per-command auto-start and rules out auto-start in read-only paths (`run list`, `run wait`, `tui`, `daemon status`), which keep reporting a missing daemon.
- Start only `deps.socketPath`/`deps.pidPath`/`deps.logPath` — the invoking digest's triple; rules out an operator pre-start requirement and rules out stopping or replacing a daemon on another key.
- Trigger the start from a failed initial connect, not from a pre-connect existence probe; rules out a probe/connect TOCTOU window and reuses the connect that already has to happen.
- Treat `DaemonAlreadyRunningError` as "the winner is up, connect to it": retry the connect instead of failing; rules out surfacing the race as a dispatch failure.
- Re-throw every other `startDaemon` error unchanged (spawn failure, readiness timeout, missing log/PID directory); rules out folding real lifecycle failures into the race path.
- Bound the post-race connect with a retry deadline driven by injected `now`/`sleep` deps on `CliDeps`, defaulting to the real clock; rules out an unbounded wait and rules out real-clock sleeps in tests.
- Exhausting the post-race deadline reports the connection failure and exits 1; rules out a silent no-op dispatch.
- Auto-start is silent on success; rules out new stdout noise on the dispatch happy path.
- Deferred to first consumer: surfacing which CLI won the race — no caller needs it.

## Tasks

- Add `now`/`sleep` deps to `CliDeps` with real-clock defaults.
- In `withAutoBounceDispatch`, on initial connect failure start the keyed daemon, then connect; on `DaemonAlreadyRunningError` skip the start and retry the connect until the deadline.
- Extend `v2/src/cli/stale-dispatch.test.ts` with the absent, present, race, and non-race-error cases, plus a differently-keyed live daemon that receives no request.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] Mutating dispatch with no daemon on the invoking digest's socket starts one at that socket/PID/log triple and then dispatches.
- [x] Mutating dispatch with the matching daemon already running dispatches without calling `startDaemon`.
- [x] Mutating dispatch succeeds while a daemon keyed by a different digest is live with running runs, and that daemon's socket receives no request.
- [x] A start that loses the race (`DaemonAlreadyRunningError`) connects to the winner and dispatches; any other `startDaemon` error surfaces as a lifecycle error with exit 1 and no dispatch.
- [x] The post-race connect retries against injected `now`/`sleep` — no real-clock delay in tests — and exits 1 with a connection error once its deadline passes.
- [x] Read-only commands (`run list`, `run wait`, `tui`, `daemon status`) still report a missing daemon rather than starting one.
- [x] New tests in `v2/src/cli/stale-dispatch.test.ts` cover the absent-daemon start and the race path and fail against the pre-change code, which reports a lifecycle error instead of starting and treats the race as a failure.
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails: the already-connected branch proves `startDaemon` is never called, the race branch proves no second start is attempted, and the non-race branch proves no connect retry happens.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — mutating dispatch starts the keyed daemon when absent, reuses it when present, and treats a lost start race as reuse; read-only commands do not auto-start.
- `v2/docs/v1-behaviors.md` — record that dispatch no longer requires a pre-started daemon.
