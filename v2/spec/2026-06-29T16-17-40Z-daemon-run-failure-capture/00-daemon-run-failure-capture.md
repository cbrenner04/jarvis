# 00 — Daemon run failure capture

When a daemon-hosted `writeLoopExecutor` rejects outside normal loop outcomes,
capture a durable `failed` run, emit one structured log event, release in-memory
worktree ownership, and keep the original error observable. Today
`createRunControlHandlers` (`v2/src/daemon.ts`) releases registry entries in
`finally` but swallows executor rejections without updating durable status or the
log stream.

## Decisions

- Unexpected executor rejections map to durable `failed`, not `blocked` — rules out
  implying agent/spec action can fix harness faults.
- Capture runs in the factory spawn boundary around `writeLoopExecutor`, after
  the RPC returns — rules out blocking `start`/`resume` on failure handling.
- On rejection: persist `failed` when `stateStore` is reachable, then append one
  failure log event when the reporter/sink is reachable — rules out a logging
  outage masking the run's failed state.
- Ownership release stays in `finally` and runs after capture attempts — rules
  out leaving the branch permanently claimed by a dead run.
- Preserve the original rejection value for diagnostics/tests — rules out
  replacing it with a generic wrapper before capture side effects complete.
- Add a new log event kind `run_execution_failed` with minimum `kind` only;
  payload fields beyond `kind` are deferred — rules out inventing tail/wait
  payload before those consumers exist.
- Deferred to first consumer: exact `run_execution_failed` payload fields — pin
  when daemon log tail or `wait` consumes them.
- Both `stateStore` and log reporter unreachable on failure: no recovery in this
  slice — rules out best-effort orphan repair.
- Log reporter failure after durable `failed` is set: keep `failed`, still
  release ownership — rules out rolling back status when only logging fails.
- Normal loop settlement (return without throw) is unchanged — rules out emitting
  `run_execution_failed` on terminal `loop_finished` paths.
- Out of scope: automatic retry, operator notification, human-loop routing.

## Task checklist

- Extend `LogEvent` with `run_execution_failed` (minimum `kind` discriminator).
- Extend `createRunControlHandlers` spawn boundary: on executor rejection, set
  durable status `failed`, invoke an injectable failure reporter with `runId` and
  the original rejection, then run existing `finally` cleanup.
- Wire production `startDaemon` failure reporter to append one
  `run_execution_failed` event via the run's log sink.
- Co-locate tests via `createRunControlHandlers` with injectable executor,
  state store, and failure reporter (reuse `daemon-start-list.test.ts` patterns).

## Acceptance criteria

- [ ] When the injected `writeLoopExecutor` rejects, the durable run row ends
  with `status: "failed"` (not `blocked` or `in-progress`).
- [ ] When the injected `writeLoopExecutor` rejects and the failure reporter is
  reachable, exactly one `run_execution_failed` event is appended for that
  `runId`.
- [ ] After executor rejection settles, `list` reports `isLive: false` for that
  run and a second `start` for the same `(project, branch)` is accepted.
- [ ] When the failure reporter throws after durable status is set to `failed`,
  the run remains `failed`, ownership is released, and `list` reports
  `isLive: false`.
- [ ] The spawn boundary surfaces the original rejection value to the injected
  failure reporter without replacing it (test asserts same `message` or
  `instanceof` as thrown).
- [ ] When the injected `writeLoopExecutor` resolves without throwing, the
  failure reporter is not called and no `run_execution_failed` event is
  appended.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Orchestration API: daemon-owned run-execution
  failure capture (`failed` status, one `run_execution_failed` log event,
  ownership release, original error preserved).
- `v2/docs/daemon-host.md` — run-execution failure behavior at the spawn
  boundary (capture order, out-of-scope dual-outage case).
- Inline doc-comments on new/changed exported symbols per
  `v2/docs/documentation-standard.md`.
- `v2/docs/v1-behaviors.md`: no change — v2-only daemon behavior.
