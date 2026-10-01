---
name: tui-supervisor-revision-respawn
---

# TUI CLI supervisor respawns the monitor on revision re-exec

## Problem

Nested revision-follow spawns leave multiple `jarvis tui` generations alive; only the leaf should own stdin/raw mode.

## Decisions

- Exactly one live TUI child plus at most one fixed supervisor: the outermost `jarvis tui` or `jarvis tui log <run-id>` process supervises; it spawns the ink monitor or log-follow child with inherited stdio and respawns when the child exits with the reserved re-exec code, passing revision marker and carried selection/expansion env as today.
- The supervisor never reads stdin and leaves raw mode off.
- Any other child exit code ends the supervisor with that code; a signal ends both.
- Log-follow re-exec uses explicit `tui log <run-id>` argv through the same supervisor path (direct CLI and in-process entry from the monitor).
- If the runtime gains `process.execve`, exec-replace is acceptable; the one-child invariant is the contract.

## Acceptance criteria

- [ ] A test with a fake spawner: three successive re-exec decisions produce three sequential children of the same supervisor, never a child spawned by a child; fails against the pre-fix nested `performTuiRevisionReexec` spawn chain.
- [ ] A test proves the reserved exit code respawns with the marker and carried selection/expansion env; any other code ends the supervisor with that code.
- [ ] A test proves log-follow re-exec routes through the same supervisor path with its explicit argv.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Revision-follow re-exec — supervisor/respawn contract and the one-process invariant; replace "spawns … and exits with the child's code".
- `v2/docs/v1-behaviors.md` — record the supervisor respawn behavior for monitor and log-follow revision-follow.

## Prerequisites

- Revision re-exec tears down ink and exits with the reserved code instead of spawning a replacement process.
- Re-exec env still carries the daemon revision marker and selection/expansion state via the existing env vars.
