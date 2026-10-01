# Revision-follow supervisor documentation

Operator-facing TUI docs and the v1 parity catalog still describe spawn-and-wait revision re-exec. Align them with the supervisor + `TUI_REVISION_REEXEC_EXIT_CODE` contract from [00](./00-tui-supervisor-reserved-reexec-exit.md) and [01](./01-tui-log-follow-supervisor-routing.md).

## Decision ledger

- Durable home for revision-follow supervisor behavior is `v2/docs/tui.md` § Revision-follow re-exec; `v2/docs/v1-behaviors.md` records the parity delta — rules out duplicating the full contract in spec prose after implementation.

## Task checklist

- Update `v2/docs/tui.md` § Revision-follow re-exec: one supervisor, one worker child, reserved exit code, channel-driven respawn env, replace spawn-and-exit-with-child-code wording; keep stability, deferral, once-per-revision, and carry-over bullets accurate.
- Update the `jarvis tui log` revision-follow bullet in `v2/docs/v1-behaviors.md` for monitor and log-follow respawn under one supervisor.

## Acceptance criteria

- [x] `v2/docs/tui.md` documents the supervisor/worker split, `TUI_REVISION_REEXEC_EXIT_CODE`, channel-driven `buildTuiReexecEnv` respawn, and the one-child invariant instead of spawning `process.argv` and exiting with the child's code.
- [x] `v2/docs/v1-behaviors.md` documents that monitor and log-follow revision re-exec respawn under one supervisor.

## Documentation updates

- `v2/docs/tui.md` — § Revision-follow re-exec supervisor/respawn contract.
- `v2/docs/v1-behaviors.md` — `jarvis tui log` revision-follow entry.
