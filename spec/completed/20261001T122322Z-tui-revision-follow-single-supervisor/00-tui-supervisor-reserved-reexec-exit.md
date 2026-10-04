# TUI supervisor and reserved revision re-exec exit

`performTuiRevisionReexec` spawns a nested `jarvis tui` / log-follow child and exits with that child's code, so each stable daemon revision adds a process generation that keeps the inherited TTY open until input dies. Bun has no `process.execve`. This subspec lands the supervisor loop and the reserved-exit child protocol together — a child that exits with the reserved code is unusable without the supervisor that respawns it.

## Decision ledger

- Exactly one live TUI worker child and at most one fixed supervisor process — rules out nested spawn-and-wait chains where each revision adds a supervisor generation (`v2/src/tui/tui-revision-reexec.ts` today).
- The outermost `jarvis tui` invocation (no supervisor-parent marker) runs the supervisor: spawns the monitor worker with inherited stdio, never reads stdin, leaves raw mode off — rules out the Ink monitor process owning the supervisor role and nesting on re-exec.
- Export `TUI_REVISION_REEXEC_EXIT_CODE` as one fixed integer not in v2 CLI 0–5 (`v2/src/cli/run-completion.ts`, `v2/src/commands/cleanup.ts`), `124` (`scripts/ready.ts` `TIMEOUT_EXIT_CODE`), `127`, or ≥128 (signal-style codes such as `130` in `v2/src/daemon/daemon-process-log.ts`) — rules out colliding with existing CLI, ready-timeout, or signal exit conventions.
- `performTuiRevisionReexec` keeps teardown order (`closeMonitor`, `closeRefreshScheduler`, `closeDaemonClient`), publishes `daemonRevision` and `carriedState` on a supervisor-owned re-exec channel (IPC or equivalent; injectable in tests), and exits with `TUI_REVISION_REEXEC_EXIT_CODE`; it never spawns — rules out preserving spawn-and-wait while adding a parallel respawn path.
- On `TUI_REVISION_REEXEC_EXIT_CODE`, the supervisor respawns the worker with `buildTuiReexecEnv(supervisorBaseEnv, daemonRevision, carriedState)` from the channel payload, not from the exited worker's environment — rules out trusting child env for revision carry-over after teardown.
- Reserved exit with no channel record ends the supervisor with `1` — rules out silent no-op respawn when the channel is missing.
- Any other worker exit code ends the supervisor with that code; signal-terminated child mapping moves out of `tuiReexecChildExitCode` in `tui-revision-reexec.ts` into the supervisor's exit helper (remove `tuiReexecChildExitCode` from the re-exec module) — rules out duplicating signal mapping on a code path that no longer waits on a spawned child.
- Supervisor-spawned workers carry a marker so they do not start another supervisor — rules out supervisor nesting when the CLI is re-invoked as the worker argv.
- `buildTuiReexecEnv`, env marker names, and selection/expansion carry semantics stay unchanged — rules out drive-by env contract changes.
- Deferred to first consumer: exact supervisor-parent/worker env marker names and channel wire shape — pin when the supervisor module's first caller needs them.

## Task checklist

- Add `TUI_REVISION_REEXEC_EXIT_CODE` and a supervisor-owned re-exec channel type with test injection hooks on `performTuiRevisionReexec`.
- Replace spawn-and-wait in `performTuiRevisionReexec` with channel publish + reserved exit (keep empty-argv guard).
- Implement the supervisor run loop for `jarvis tui` (spawn worker, await exit, respawn on reserved code, propagate other codes); wire from `runTuiCommand` / production `runTuiEntry` deps so direct `jarvis tui` uses it.
- Move child signal exit mapping into the supervisor exit helper; delete `tuiReexecChildExitCode` from `tui-revision-reexec.ts` and relocate its behavioral tests to `v2/src/tui/tui-supervisor.test.ts`.
- Add `v2/src/tui/tui-supervisor.test.ts` with a fake spawner covering multi-hop reserved exits, env from channel + `buildTuiReexecEnv`, non-reserved exits, and missing channel on reserved exit.

## Acceptance criteria

- [x] `v2/src/tui/tui-revision-reexec.test.ts` proves `performTuiRevisionReexec` runs teardown, publishes matching `daemonRevision` and `carriedState` on an injected channel, and exits `TUI_REVISION_REEXEC_EXIT_CODE` via an injected exit hook without spawning; fails against the pre-fix spawn-and-wait implementation in `v2/src/tui/tui-revision-reexec.ts`.
- [x] `v2/src/tui/tui-supervisor.test.ts` proves three successive reserved exits produce three sequential worker children of the same supervisor and no worker spawns its own child; respawn env equals `buildTuiReexecEnv` over channel revision/state; any other worker code and reserved exit with no channel record end the supervisor with that code (missing channel → `1`); fails when the supervisor module is absent (reachable on main via nested `performTuiRevisionReexec` spawn).
- [x] `v2/src/tui/tui-revision-reexec.test.ts` `buildTuiReexecEnv` and `performTuiRevisionReexec` argv-guard tests stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None in this subspec (operator docs land in [02](./02-revision-follow-supervisor-docs.md)).
