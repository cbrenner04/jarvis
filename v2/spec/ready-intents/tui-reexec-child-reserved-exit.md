---
name: tui-reexec-child-reserved-exit
---

# TUI revision re-exec child exits with a reserved code instead of spawning

## Problem

`performTuiRevisionReexec` spawns a replacement process and waits for it, so every revision-follow decision nests another long-lived ancestor that keeps the inherited TTY open.

## Decisions

- Export `TUI_REVISION_REEXEC_EXIT_CODE` as a single fixed integer outside harness/CLI exits in use (1, 6, 7, 8, 10, 11, 124).
- After teardown, apply `buildTuiReexecEnv` to `process.env`, publish the same `daemonRevision` and `carriedState` on the supervisor re-exec channel (injectable in tests; the supervisor slice owns consumption), and exit with `TUI_REVISION_REEXEC_EXIT_CODE`; do not spawn.
- Remove `tuiReexecChildExitCode` from this module; propagating a real child exit code belongs in the supervisor slice.
- Env marker and selection/expansion carry semantics stay as today.

## Acceptance criteria

- [ ] `tui-revision-reexec.test.ts` (injectable exit hook): `performTuiRevisionReexec` runs teardown, builds env with the revision marker and carried selection/expansion, publishes matching revision/state on the re-exec channel, and exits with `TUI_REVISION_REEXEC_EXIT_CODE` without spawning; fails against the pre-fix spawn-and-wait implementation.
- [ ] `tui-revision-reexec.test.ts` `buildTuiReexecEnv` and argv guard tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None (supervisor contract and `TUI_REVISION_REEXEC_EXIT_CODE` symbol are documented in the CLI supervisor intent).

## Prerequisites
