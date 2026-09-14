# `tui log` revision-follow re-exec

`runTuiLogFollow` (`v2/src/tui/tui-log-follow-entry.tsx`) never compares its revision with the daemon's, so a long-lived follow keeps running stale code after a daemon upgrade. `runTuiLogFollow` also runs in-process from the monitor's `log` action (`tui-entry.tsx`, after the monitor tears itself down), not only from the direct `jarvis tui log <run-id>` CLI dispatch.

## Decisions

- Check points are initial connect and each mid-stream tail-resume reconnect attempt only; no new timer — rules out adding a status poll loop.
- Each check issues two back-to-back `status` reads fed to `decideTuiRevisionReexec` as previous/current — rules out tracking only across check points, where a lone initial connect never reaches two-read stability. These reads land milliseconds apart, a weaker stability signal than the monitor's tick-spaced reads; accepted because a spurious re-exec during a daemon bounce only moves the follow onto newer code, never onto wrong data.
- Call `decideTuiRevisionReexec` with `dockInputEmpty: true`, `dispatchPending: false`, and `reexecedForRevision` from `readTuiReexecedForRevision(process.env)` — rules out a log-specific predicate. This also means a monitor that already re-exec'd for a stable revision (env marker set) and then enters log-follow in-process for that same revision does not re-exec again: the follow honors the inherited marker via the shared once-per-revision guard rather than re-firing right behind the monitor's own re-exec.
- Re-exec spawns explicit argv `[process.argv[0], process.argv[1], "tui", "log", runId]`, passed as a new `argv` override on `PerformTuiRevisionReexecParams` (default: unmodified `process.argv`) — rules out reusing unmodified `process.argv`, which is `jarvis tui` (no `log`, no run id) when `runTuiLogFollow` runs in-process from the monitor's `log` action, and would silently re-exec back into the monitor instead of continuing the follow for the run id. The same explicit-argv construction also covers a direct `jarvis tui log <run-id>` invocation (where it matches the ambient argv anyway), so one code path serves both entry points.
- Re-exec's `closeDaemonClient` teardown slot closes the tail (`tail?.close()`), `closeMonitor` closes the log-follow session (`session?.close()`); `closeRefreshScheduler` is a no-op (log-follow has no scheduler). Carried state is the fixed empty `TuiReexecCarriedState` (`{ selectedNodeId: null, expandedPipelineNodeIds: [] }`) — log-follow has no selection/expansion state to carry.
- Revision resolver and status read are injectable via `RunTuiLogFollowDeps`, defaulting to the monitor's production implementations; the re-exec action is injectable, defaulting to `performTuiRevisionReexec` called with the explicit argv above instead of its `process.argv` default.
- A failed status read never re-execs and never fails the follow; tailing proceeds — rules out treating a status error as transport loss.

## Acceptance criteria

- [ ] A test in `v2/src/tui/tui-log-follow-entry.test.tsx` proves that, given a stable daemon revision differing from the loaded revision, `runTuiLogFollow` invokes the re-exec action with argv targeting `tui log <run-id>` for the run id being followed, without operator input, on initial connect and again on a tail-resume reconnect; against the pre-fix code, a stable mismatch never invokes any re-exec action.
- [ ] The same test file proves none of the following re-exec: matching daemon/loaded revisions, a daemon-reported `unknown` revision, a loaded (local) revision of `unknown`, a failed status read, and an already-re-exec'd marker for the daemon's current stable revision (once-per-revision guard, ruling out a re-exec loop) — tailing continues in every case.
- [ ] A test proves the in-process path entered from the monitor's `log` action re-execs with argv `tui log <run-id>` for the run id being followed, not the monitor's own invocation argv.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` — extend the `jarvis tui log` transport-loss-recovery section with revision-follow re-exec on connect/tail-resume, including that the in-process `log`-action path re-execs with explicit `tui log <run-id>` argv rather than the monitor's own invocation argv; drop `jarvis tui log` from the monitor section's out-of-scope sentence.
- `v2/docs/v1-behaviors.md` — add a `[v2 behavior change]` entry: `jarvis tui log` re-execs on stable daemon revision mismatch at connect/tail-resume, including when entered in-process via the monitor's `log` action.
