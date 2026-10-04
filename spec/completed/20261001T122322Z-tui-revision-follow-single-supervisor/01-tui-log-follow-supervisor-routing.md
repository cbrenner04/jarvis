# TUI log-follow through the supervisor

`jarvis tui log <run-id>` and in-process log-follow from the monitor share revision-follow re-exec with the monitor. After [00](./00-tui-supervisor-reserved-reexec-exit.md), reserved-exit respawn must cover log-follow argv (`tuiLogFollowReexecArgv`) as well as bare `jarvis tui`, including when `runTuiLogFollow` runs in-process after the monitor's `log` action tears down.

## Decision ledger

- The outermost `jarvis tui log <run-id>` invocation uses the same supervisor loop as `jarvis tui` — rules out a log-only nested spawn chain parallel to the monitor fix.
- Log-follow revision re-exec keeps explicit `[executable, …, "tui", "log", runId]` argv via `tuiLogFollowReexecArgv` (`v2/src/tui/tui-log-follow-entry.tsx`) — rules out re-spawning unmodified `process.argv` when the monitor entered log-follow in-process (`jarvis tui` argv would drop back into the monitor).
- In-process monitor `log` → `runTuiLogFollow` stays in the existing worker process under the already-running supervisor; revision re-exec from log-follow still exits with `TUI_REVISION_REEXEC_EXIT_CODE` for supervisor respawn — rules out a second supervisor or a direct spawn bypass for in-process log-follow.
- Env marker and once-per-revision guard semantics for log-follow stay aligned with the monitor (`decideTuiRevisionReexec`, `readTuiReexecedForRevision`) — rules out log-specific revision policy in this subspec.

## Task checklist

- Wire `jarvis tui log <run-id>` through the supervisor at the same seam as `jarvis tui` (`runTuiCommand` / production deps).
- Ensure log-follow `performTuiRevisionReexec` calls keep `argv: tuiLogFollowReexecArgv(runId)` and rely on reserved exit + supervisor respawn instead of spawning.
- Extend supervisor tests or log-follow entry tests to cover direct CLI log-follow and in-process monitor `log` revision re-exec paths.

## Acceptance criteria

- [x] `v2/src/tui/tui-supervisor.test.ts` or `v2/src/tui/tui-log-follow-entry.test.ts` proves log-follow revision re-exec from direct `jarvis tui log <run-id>` dispatch and from in-process monitor `log` routes through the supervisor respawn with `tui` / `log` / `<run-id>` argv (not nested child spawn); fails against pre-fix `performTuiRevisionReexec` spawn in `v2/src/tui/tui-revision-reexec.ts`.
- [x] `v2/src/tui/tui-log-follow-entry.test.ts` `tuiLogFollowReexecArgv` guard tests stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None in this subspec (operator docs land in [02](./02-revision-follow-supervisor-docs.md)).
