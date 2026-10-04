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
- `start` and `resume` share the same spawn-boundary capture path — rules out
  resume-only gap.
- On rejection: best-effort persist `failed` when `stateStore` is reachable (skip
  when durable status already terminal), then await injectable failure reporter —
  rules out clobbering settled runs and fire-and-forget races against ownership
  release.
- Required `failureReporter` on `RunControlHandlerDeps`:
  `(runId, reason: unknown) => void | Promise<void>`; tests pass noop; migrate
  existing factory consumers — rules out optional reporter.
- Spawn boundary awaits failure reporter (sync or async) before `finally` cleanup
  — rules out ownership-release races.
- `startDaemon` failure reporter opens log sink via `logsPath` when executor
  failed before sink creation — rules out requiring a pre-opened sink from the
  executor wrapper.
- Spawn-boundary capture does not call `commitCompletionBoundary` — rules out
  repairing attempt state on harness faults; durable `failed` with latest attempt
  still `in-progress` is accepted skew.
- No terminal-status overwrite: capture skips `setRunStatus("failed")` when
  durable status is already terminal (`completed`, `blocked`, `killed`, `paused`,
  `failed`) — rules out clobbering normal settlement or operator `kill`.
- `setRunStatus` on rejection is best-effort: `finally` still releases ownership
  when persist throws; no recovery — rules out blocking cleanup on state-store
  failure (aligned with dual-outage out-of-scope).
- Original rejection forwarded to injected reporter only; spawn boundary does not
  rethrow to RPC callers or add daemon stderr — rules out duplicating
  diagnostics outside the reporter contract.
- Ownership release stays in `finally` after capture attempts — rules out leaving
  the branch permanently claimed by a dead run.
- Add `run_execution_failed` log event kind with minimum `kind` only; payload
  fields beyond `kind` deferred — rules out inventing tail payload before
  consumers exist.
- Deferred to first consumer: exact `run_execution_failed` payload fields — pin
  when daemon log tail consumes them.
- Deferred to first consumer: `wait` on `run_execution_failed` — pin in
  `daemon-wait-run-completion` when that consumer exists.
- Both `stateStore` and log reporter unreachable on failure: no recovery in this
  slice — rules out best-effort orphan repair.
- Log reporter failure after durable `failed` is set: keep `failed`, still
  release ownership — rules out rolling back status when only logging fails.
- Normal loop settlement (return without throw) is unchanged — rules out emitting
  `run_execution_failed` on terminal `loop_finished` paths.
- Out of scope: automatic retry, operator notification, human-loop routing.

## Task checklist

- Extend `LogEvent` with `run_execution_failed` (minimum `kind` discriminator).
- Add required `failureReporter` to `RunControlHandlerDeps`; migrate existing
  factory consumers (noop in tests).
- Extend `createRunControlHandlers` spawn boundary (`start` and `resume`): on
  executor rejection, skip status update when already terminal, else best-effort
  `setRunStatus("failed")`, await `failureReporter(runId, reason)`, then existing
  `finally` cleanup.
- Wire production `startDaemon` failure reporter to open log sink via `logsPath`
  and append one `run_execution_failed` event.
- Add `daemon-run-failure-capture.test.ts` (or extend `daemon-start-list.test.ts`;
  preservation AC pins the other file).

## Acceptance criteria

- [x] When the injected `writeLoopExecutor` rejects, the durable run row ends
  with `status: "failed"` (not `blocked` or `in-progress`).
- [x] When the injected `writeLoopExecutor` rejects and the failure reporter is
  reachable, exactly one `run_execution_failed` event is appended for that
  `runId`.
- [x] After executor rejection capture, durable run is `failed` even when the
  latest attempt row remains `in-progress`.
- [x] After executor rejection settles, `list` reports `isLive: false` for that
  run and a second `start` for the same `(project, branch)` is accepted.
- [x] When the failure reporter throws after durable status is set to `failed`,
  the run remains `failed`, ownership is released, and `list` reports
  `isLive: false`.
- [x] The spawn boundary surfaces the original rejection value to the injected
  failure reporter without replacing it (test asserts same `message` or
  `instanceof` as thrown).
- [x] When durable status is already terminal before spawn-boundary capture runs,
  `setRunStatus` is not called with `failed` and the prior terminal status is
  unchanged.
- [x] When the injected `writeLoopExecutor` resolves without throwing, the
  failure reporter is not called and no `run_execution_failed` event is
  appended.
- [x] `startDaemon` supplies a failure reporter that appends `run_execution_failed`
  through the production log sink (integration-style or thin dep injection).
- [x] `daemon-start-list.test.ts` stays green (updated for required
  `failureReporter` noop as needed).
- [x] `v2/docs/v2-architecture.md` documents daemon-owned run-execution failure
  capture (`failed` status, one `run_execution_failed` log event, ownership
  release, original error preserved to reporter).
- [x] `v2/docs/daemon-host.md` documents spawn-boundary failure capture order,
  dual-outage out-of-scope case, and post-failure operator shape (`list`:
  `status: "failed"`, `isLive: false`).
- [x] Inline doc-comments on changed exported symbols (`RunControlHandlerDeps`,
  `createRunControlHandlers`) per `v2/docs/documentation-standard.md`.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Orchestration API: daemon-owned run-execution
  failure capture (`failed` status, one `run_execution_failed` log event,
  ownership release, original error preserved to reporter).
- `v2/docs/daemon-host.md` — spawn-boundary failure capture order,
  dual-outage out-of-scope case, post-failure operator shape in `list` table or
  explicit cross-link (`status: "failed"`, `isLive: false`).
- Inline doc-comments on `RunControlHandlerDeps`, `createRunControlHandlers`.
- `v2/docs/v1-behaviors.md`: no change — v2-only daemon behavior.
