---
name: tui-reexec-child-reserved-exit
---

# TUI revision re-exec child exits with a reserved code instead of spawning

## Problem

`performTuiRevisionReexec` spawns a replacement process and waits for it, so every revision-follow decision nests another long-lived ancestor that keeps the inherited TTY open.

## Decisions

- Export a reserved process exit code meaning "supervisor should respawn the monitor with carried env."
- After teardown, the re-exec path sets env via `buildTuiReexecEnv` and exits with that code; it does not spawn.
- Env marker and selection/expansion carry semantics stay as today.

## Acceptance criteria

- [ ] A regression test with an injectable exit hook proves `performTuiRevisionReexec` runs teardown, builds env with the revision marker and carried selection/expansion, and exits with the reserved code without spawning; it fails against the pre-fix spawn-and-wait implementation.
- [ ] `tui-revision-reexec.test.ts` env and argv guard tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None (supervisor contract is documented in the CLI supervisor intent).

## Prerequisites
