# Trim CLI, TUI, and testing exports

Listed symbols in `v2/src/cli.ts`, `v2/src/config/agent-model-config.ts`,
`v2/src/testing/bindings.ts`, and `v2/src/tui/` are exported but have no import
outside their defining file. Drop `export` (or delete when unused internally).
No operator-facing or runtime behavior change.

## Decisions

- De-export or delete listed symbols only — rules out refactors, renames, or new public seams.
- TUI daemon client result/transport types stay module-internal unless referenced outside `v2/src/tui/` — rules out preserving exports for hypothetical external consumers.
- Listed symbols used only in-file today are de-exported, not deleted — rules out removing `EXECUTABLE_ROLES` / `ExecutableRole` / `SimulatedOutcome` / TUI result types that remain referenced internally.
- `createTuiDaemonRpcTransport` and other exports outside the intent list are untouched — rules out drive-by surface trimming.

## Task checklist

- [ ] `v2/src/cli.ts`: remove `export` from `Io` (delete if unused internally).
- [ ] `v2/src/config/agent-model-config.ts`: remove `export` from `EXECUTABLE_ROLES` and `ExecutableRole` (delete if unused internally).
- [ ] `v2/src/testing/bindings.ts`: remove `export` from `SimulatedOutcome` (delete if unused internally).
- [ ] `v2/src/tui/tui-daemon-client.ts`: remove `export` from `TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult` (delete if unused internally).
- [ ] `v2/src/tui/tui-daemon-rpc-transport.ts`: remove `export` from `TuiDaemonRpcTransport` (delete if unused internally).

## Acceptance criteria

- [ ] `Io`, `EXECUTABLE_ROLES`, `ExecutableRole`, `SimulatedOutcome`, `TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult`, and `TuiDaemonRpcTransport` are not exported from their defining modules (or are absent when unused internally).
- [ ] No other `export` is removed from the scoped modules beyond the symbols above.
- [ ] `cli.test.ts` stays green.
- [ ] `agent-model-config.test.ts` stays green.
- [ ] `write-loop.test.ts` stays green.
- [ ] `tui-daemon-client.test.ts` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change.
