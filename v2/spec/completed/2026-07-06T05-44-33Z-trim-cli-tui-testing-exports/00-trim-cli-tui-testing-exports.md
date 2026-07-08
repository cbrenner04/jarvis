# Trim CLI, TUI, and testing exports

Listed symbols in `v2/src/cli.ts`, `v2/src/config/agent-model-config.ts`,
`v2/src/testing/bindings.ts`, `v2/src/tui/tui-daemon-client.ts`, and
`v2/src/tui/tui-daemon-rpc-transport.ts` are exported but have no import outside
their defining file. Drop `export` (or delete when unused internally). No
operator-facing or runtime behavior change.

## Decisions

- De-export or delete listed symbols only — rules out refactors, renames, or new public seams.
- Remove nominal `export` on listed TUI symbols; structural exposure via exported function/class return types is unchanged — rules out treating de-export as hiding shapes already on `TuiDaemonClient` signatures.
- Listed symbols used only in-file today are de-exported, not deleted — rules out removing `EXECUTABLE_ROLES` / `ExecutableRole` / `SimulatedOutcome` / TUI result types that remain referenced internally.
- `createTuiDaemonRpcTransport` and other exports outside the intent list are untouched — rules out drive-by surface trimming.
- Land before seed `02-v2-dead-weight-purge`; seed 02 omits these eight symbols from its de-export list — rules out parallel duplicate edits in overlapping files.
- Scoped export-audit test pins AC #1 — rules out honor-system tick discipline as the only guard.
- Doc-comment edits only when compile or lint requires them — rules out drive-by comment churn on de-exported symbols.

## Task checklist

- [ ] Re-audit each file's imports before editing (drift since spec merge).
- [ ] `v2/src/cli.ts`: remove `export` from `Io` (delete if unused internally).
- [ ] `v2/src/config/agent-model-config.ts`: remove `export` from `EXECUTABLE_ROLES` and `ExecutableRole` (delete if unused internally).
- [ ] `v2/src/testing/bindings.ts`: remove `export` from `SimulatedOutcome` (delete if unused internally).
- [ ] `v2/src/tui/tui-daemon-client.ts`: remove `export` from `TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult` (delete if unused internally).
- [ ] `v2/src/tui/tui-daemon-rpc-transport.ts`: remove `export` from `TuiDaemonRpcTransport` (delete if unused internally).
- [ ] Add `v2/src/export-surface-trim.test.ts` scoped export-audit for the eight symbols.

## Acceptance criteria

- [x] `v2/src/export-surface-trim.test.ts` asserts `Io`, `EXECUTABLE_ROLES`, `ExecutableRole`, `SimulatedOutcome`, `TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult`, and `TuiDaemonRpcTransport` are not named exports of their defining modules (or are absent when unused internally).
- [x] No other `export` is removed from `v2/src/cli.ts`, `v2/src/config/agent-model-config.ts`, `v2/src/testing/bindings.ts`, `v2/src/tui/tui-daemon-client.ts`, or `v2/src/tui/tui-daemon-rpc-transport.ts` beyond the symbols above.
- [x] `v2/src/cli.test.ts` stays green.
- [x] `v2/src/config/agent-model-config.test.ts` stays green.
- [x] `v2/src/execution/write-loop.test.ts` stays green.
- [x] `v2/src/tui/tui-daemon-client.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change.
