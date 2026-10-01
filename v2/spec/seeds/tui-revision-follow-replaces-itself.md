---
name: tui-revision-follow-replaces-itself
---

# TUI revision-follow replaces itself instead of nesting

## Problem

`performTuiRevisionReexec` (`v2/src/tui/tui-revision-reexec.ts`) tears down the monitor, then `spawn`s `process.argv` with inherited stdio and awaits the child's exit before `process.exit`. The parent never leaves, so every stable daemon revision adds one generation. Bun 1.3 has no `process.execve`, so a true exec is not available in-process. Each ancestor keeps the inherited TTY open; ancestors still holding stdin after ink unmount is the likely cause of the dead input.

## Evidence

- 2026-09-30, operator TUI on ttys001: 19-process chain, root `bun run` 71271 → … → leaf 70268, ~18 generations matching ~18 `main` merges that day; the TUI was unresponsive.
- `v2/docs/tui.md` § Revision-follow re-exec specifies "spawns `process.argv` … and exits with the child's code", so the nesting is documented behavior.

## Decisions

- Exactly one TUI process at any time, plus at most one fixed supervisor. The first `jarvis tui` process becomes the supervisor: it runs the monitor as a child and respawns it when the child exits with a reserved re-exec exit code, passing the revision marker and selection/expansion state through env as today. A re-exec'ing child exits instead of spawning.
- If the runtime gains `process.execve`, exec-replace is acceptable instead; the one-process invariant is the contract, not the mechanism.
- The supervisor never reads stdin and leaves raw mode off, so only the live monitor owns the TTY.
- Same rule for `jarvis tui log <run-id>` (its explicit argv still applies) and for log-follow entered in-process from the monitor.
- Any other child exit code ends the supervisor with that code; a signal ends both.

## Acceptance criteria

- [ ] Test with a fake spawner: three successive re-exec decisions produce three sequential children of the same supervisor, never a child spawned by a child; fails against the pre-fix `performTuiRevisionReexec`.
- [ ] Test: the reserved exit code respawns with the marker and carried selection/expansion env; any other code ends the supervisor with that code.
- [ ] Test: log-follow re-exec routes through the same supervisor path with its explicit argv.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Revision-follow re-exec — supervisor/respawn contract and the one-process invariant; replace "spawns … and exits with the child's code".
