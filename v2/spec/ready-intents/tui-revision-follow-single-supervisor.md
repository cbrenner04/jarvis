---
name: tui-revision-follow-single-supervisor
---

# TUI revision-follow respawns under one supervisor instead of nesting

## Problem

`performTuiRevisionReexec` (`v2/src/tui/tui-revision-reexec.ts`) tears down, then `spawn`s `process.argv` with inherited stdio and awaits the child before `process.exit(tuiReexecChildExitCode(code))`. Every stable daemon revision adds a generation that keeps the inherited TTY open (2026-09-30: 19-process chain on ttys001, ~18 `main` merges, input dead). Bun has no `process.execve`.

## Decisions

- One plan, chained subspecs on one branch: (1) supervisor + reserved-exit child for `jarvis tui`; (2) `jarvis tui log <run-id>` and in-process log-follow through the same supervisor; (3) docs. Subspec 1 lands both halves together: a child exiting with the reserved code is broken without the supervisor.
- Invariant: exactly one live TUI child plus at most one fixed supervisor. The outermost `jarvis tui` / `jarvis tui log <run-id>` process supervises: spawns the monitor or log-follow child with inherited stdio, never reads stdin, leaves raw mode off.
- Export `TUI_REVISION_REEXEC_EXIT_CODE`: one fixed integer outside codes in use: v2 CLI 0–5 (`v2/src/cli/run-completion.ts`, `v2/src/commands/cleanup.ts`), 124 (`scripts/ready.ts` `TIMEOUT_EXIT_CODE`), 127, and ≥128 (signal codes, e.g. 130 in `v2/src/daemon/daemon-process-log.ts`).
- `performTuiRevisionReexec` keeps teardown order, publishes `daemonRevision` and `carriedState` on a supervisor-owned re-exec channel (IPC or equivalent; injectable in tests), and exits with `TUI_REVISION_REEXEC_EXIT_CODE`; it never spawns. Empty-argv guard stays.
- On the reserved code the supervisor respawns with `buildTuiReexecEnv(supervisorBaseEnv, daemonRevision, carriedState)` from the channel, never from the exited child's environment; reserved code with no channel record ends the supervisor with 1.
- Any other child code ends the supervisor with that code; signal-terminated mapping moves from `tuiReexecChildExitCode` (removed from `tui-revision-reexec.ts`) into the supervisor's exit helper; a signal ends both.
- Log-follow re-exec keeps explicit `tui log <run-id>` argv (`tuiLogFollowReexecArgv`) and routes through the same supervisor, from direct CLI and from the monitor's in-process `log` action.
- Env marker and selection/expansion carry semantics unchanged. `process.execve`, if added, may replace the supervisor; the one-child invariant is the contract.

## Acceptance criteria

- [ ] `v2/src/tui/tui-revision-reexec.test.ts`: `performTuiRevisionReexec` runs teardown, publishes matching revision/state on an injected channel, and exits `TUI_REVISION_REEXEC_EXIT_CODE` via an injected exit hook without spawning; fails against the spawn-and-wait implementation. Existing `buildTuiReexecEnv` and argv guard tests stay green.
- [ ] `v2/src/tui/tui-supervisor.test.ts` (fake spawner): three successive reserved exits produce three sequential children of the same supervisor, never a child spawned by a child; respawn env equals `buildTuiReexecEnv` over channel revision/state; any other code (and a missing channel record → 1) ends the supervisor with that code.
- [ ] `v2/src/tui/tui-supervisor.test.ts` or `v2/src/tui/tui-log-follow-entry.test.ts`: log-follow re-exec, direct and in-process from the monitor, routes through the supervisor with `tui log <run-id>` argv.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Revision-follow re-exec — supervisor/respawn contract, `TUI_REVISION_REEXEC_EXIT_CODE`, one-child invariant; replace "spawns … and exits with the child's code".
- `v2/docs/v1-behaviors.md` — update the `jarvis tui log` revision-follow entry: monitor and log-follow respawn under one supervisor.

## Prerequisites
