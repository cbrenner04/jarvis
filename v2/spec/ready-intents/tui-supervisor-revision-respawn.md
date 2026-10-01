---
name: tui-supervisor-revision-respawn
---

# TUI CLI supervisor respawns the monitor on revision re-exec

## Problem

Nested revision-follow spawns leave multiple `jarvis tui` generations alive; only the leaf should own stdin/raw mode.

## Decisions

- Exactly one live TUI child plus at most one fixed supervisor: the outermost `jarvis tui` or `jarvis tui log <run-id>` process supervises; it spawns the ink monitor or log-follow child with inherited stdio and respawns when the child exits with `TUI_REVISION_REEXEC_EXIT_CODE`.
- The supervisor cannot read the child's environ after `wait`. On reserved exit it respawns with `buildTuiReexecEnv(supervisorBaseEnv, daemonRevision, carriedState)` using `daemonRevision` and `carriedState` taken from the explicit re-exec channel the child publishes before exiting (same fields as `performTuiRevisionReexec`), not from the exited process environment.
- The supervisor never reads stdin and leaves raw mode off.
- Any other child exit code ends the supervisor with that code (signal-terminated child codes map as today via the supervisor's exit helper); a signal ends both.
- Log-follow re-exec uses explicit `tui log <run-id>` argv through the same supervisor path (direct CLI and in-process entry from the monitor).
- If the runtime gains `process.execve`, exec-replace is acceptable; the one-child invariant is the contract.

## Acceptance criteria

- [ ] A test with a fake spawner: three successive re-exec decisions produce three sequential children of the same supervisor, never a child spawned by a child; fails against the pre-fix nested `performTuiRevisionReexec` spawn chain.
- [ ] A test proves `TUI_REVISION_REEXEC_EXIT_CODE` respawns with env matching `buildTuiReexecEnv` for revision/state read from the re-exec channel; any other code ends the supervisor with that code.
- [ ] A test proves log-follow re-exec routes through the same supervisor path with its explicit argv.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Revision-follow re-exec — supervisor/respawn contract, `TUI_REVISION_REEXEC_EXIT_CODE`, and the one-process invariant; replace "spawns … and exits with the child's code".
- `v2/docs/v1-behaviors.md` — record the supervisor respawn behavior for monitor and log-follow revision-follow.

## Prerequisites

- Revision re-exec tears down ink and exits with the reserved code instead of spawning a replacement process.
- Re-exec env still carries the daemon revision marker and selection/expansion state via the existing env vars.
- Plan both intents as subspecs in one spec; landing only the re-exec child slice leaves revision-follow broken until the supervisor slice ships.
