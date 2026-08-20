# Force-settle a non-active run on kill

## Problem

`killHandler` (`v2/src/daemon/daemon.ts`) only acts when `activeRunAcceptsKill` matches a live `activeRuns` entry; every other row falls through to `run_not_active` with no durable write. A `paused` row whose loop is gone — the daemon that owned it has since restarted, or `resume` refuses it with `unsupported_resume_context` — is therefore neither resumable nor killable. `paused` is not in `TERMINAL_RUN_STATUSES`, so `retainListedRuns` never ages it out of the 50-newest-terminal window: it paints in `run list` and the tui work tree forever (observed 2026-08-16 on two 2026-08-11 rows for `20260811T173344Z-tui-left-pane-width-and-timing-threshold`). Startup reconciliation cannot reach it either — `beginRunReconciliation` only settles rows whose recorded owner process is dead, and this row's owner is the still-live daemon.

## Decision ledger

- Force is an optional `force?: boolean` param on the existing `kill` RPC; rules out a new RPC verb that the tui client, wire docs, and CLI would each have to learn.
- The live-run check runs first, so `force` on an active row takes the existing abort path unchanged; rules out force becoming a way to skip a live loop's abort/checkpoint sequence.
- Force settles through `store.commitGuardedKill(runId)`; rules out deleting the row or writing `status = 'killed'` without a finish timestamp, either of which breaks `finishedAtMs` projection and terminal retention.
- The handler carries its own `isBoundaryTerminalRunStatus` check and refuses `run_not_active` on `completed`/`blocked`/`failed`/`interrupted`; rules out leaning on `commitGuardedKill`'s internal guard, which no-ops silently and would answer `ok` for a row nothing killed.
- Force on an already-`killed` row is accepted and re-stamps `finished_at`; rules out treating `killed` as boundary-terminal here, which would make the force path non-idempotent against a concurrent settle.
- Force does not consult resume admissibility: any non-active, non-boundary-terminal row is settleable; rules out gating on `unsupported_resume_context`, which would leave every other flavor of stuck non-active row unclearable and couple kill to resume's reconstruction logic.
- The force path appends no log record; rules out synthesizing a `loop_finished` or `run_reconciled` event, which would attribute the settle to a loop or a restart sweep that never ran.
- `resume`, `pause`, reconstruction, and startup reconciliation are untouched.
- Deferred to first consumer: CLI/tui exposure of `force` (`jarvis run kill --force` or a tui affordance) — pin when an operator surface needs it.

## Task checklist

- Import `isBoundaryTerminalRunStatus` from `../persistence/state-store.ts` in `v2/src/daemon/daemon.ts`.
- Widen `killHandler`'s params cast to `{ runId?: string; force?: boolean }` and replace the trailing `run_not_active` return with the force branch (force gate, boundary gate, `commitGuardedKill`, `ok`).
- Add `v2/src/daemon/daemon-force-kill.test.ts` covering force-settlement, the no-force refusal, the boundary refusal, and the active-run abort path, with in-body `// @mutate` directives on the real guards.
- Add the force-settled retention case to `v2/src/daemon/daemon-terminal-run-retention.test.ts`.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `daemon-force-kill.test.ts` test `force kill settles a non-active paused run to killed with a finish timestamp` fails against the pre-fix code, then proves a `kill` request with `{ runId, force: true }` on a `paused` row that has no `activeRuns` entry returns `{ ok: true }` and leaves the durable row `status: "killed"` with a non-null `finishedAt`.
- [ ] `daemon-force-kill.test.ts` test `kill without force leaves a non-active paused run untouched` proves the same row still answers `run_not_active` and stays `paused` with `finishedAt` null when `force` is omitted.
- [ ] `daemon-force-kill.test.ts` test `force kill on a boundary-terminal row is refused and leaves the row unchanged` proves `{ force: true }` against `completed`, `blocked`, and `failed` rows answers `run_not_active` and leaves each row's recorded status and `finishedAt` exactly as stored.
- [ ] `daemon-force-kill.test.ts` test `force kill on an active run takes the abort path` proves `{ force: true }` on a live write-loop run triggers the executor's abort signal and records `killed`, identically to the no-force path (behavior unchanged by the force branch).
- [ ] `daemon-terminal-run-retention.test.ts` test `a force-settled row drops out of list behind 50 newer terminal runs` fails against the pre-fix code, then proves a force-settled row is absent from `list` once 50 newer terminal rows exist while its durable row is still loadable.
- [ ] `v2/src/daemon/daemon-force-kill.test.ts` — `force kill settles a non-active paused run to killed with a finish timestamp`; Keystone checkpoint: an in-body `// @mutate` directive flipping the force gate to `if (true) {` restores baseline semantics (every non-active row refused regardless of `force`), turning this test red while the no-force and boundary-terminal tests stay green.
- [ ] `v2/src/daemon/daemon-force-kill.test.ts` — `kill without force leaves a non-active paused run untouched`; Mutation checkpoint: an in-body `// @mutate` directive neutering the force gate to `if (false) {` makes a plain `kill` settle the non-active row, turning this test red on the refused-and-unchanged assertions.
- [ ] `v2/src/daemon/daemon-force-kill.test.ts` — `force kill on a boundary-terminal row is refused and leaves the row unchanged`; Mutation checkpoint: an in-body `// @mutate` directive neutering the boundary gate to `if (false) {` makes a forced kill answer `ok` for `completed`/`blocked`/`failed` rows, turning this test red.
- [ ] Existing kill coverage in `v2/src/daemon/daemon-start-list.test.ts` (`kill aborts an active run and records killed status`, `kill rejects unknown run ID`, `kill preserves boundary-terminal status on an active run but still aborts`, `kill still sets killed on a paused run`) and the workflow kill/pause cases in `v2/src/daemon/daemon-workflow-start.test.ts` stay green (no-force behavior unchanged).
- [ ] `v2/docs/daemon-host.md` — the `kill` RPC row records the `force?: boolean` param, that force settles a non-active, non-boundary-terminal row durably `killed` with a finish timestamp, that an active row takes the abort path whether or not force is set, that boundary-terminal rows are refused `run_not_active`, and that a force-settled row is an ordinary terminal row for `finishedAtMs` and terminal retention; the workflow live-controls section's non-live `run_not_active` sentence records the force exception.
- [ ] `v2/docs/v1-behaviors.md` — the `[v2-only]` live-kill bullet records that `kill` also force-settles a non-active, non-boundary-terminal row without abort, and that v1 has no equivalent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `kill` RPC row (`force` param, non-active force settlement, active-row precedence, boundary refusal, retention/`finishedAtMs` status of a force-settled row); § Live controls on workflow-started runs, non-live rows.
- `v2/docs/v1-behaviors.md` — extend the `[v2-only]` live-kill bullet with force settlement of non-active rows.

## Implementer notes

- Suggested handler shape after the existing `activeRunAcceptsKill` block, keeping each guard on one physical line so the directives quote unique text: `if (params.force !== true) {` … `if (isBoundaryTerminalRunStatus(run.status)) {` … then `store.commitGuardedKill(runId);` and the `ok` response. Both guards return the current `run_not_active` error verbatim.
- The two `run_not_active` returns can share one local const inside `killHandler`; keep the guard `if (…) {` lines themselves unmerged so each directive has a stable single-line anchor.
- If `noExcessiveCognitiveComplexity` (max 24, `v2/src/**/*.ts`) trips, lift the force settlement into a module-level helper taking `(store, run)` and keep both guard lines inside it — the directives anchor on the guard text, not a line number.
- Seed the non-active rows directly with `stateStore.createRun({ …, status: "paused" })` against handlers built by `createRunControlHandlers`; no `startRunDirect` call, so no `activeRuns` entry exists. `daemon-terminal-run-retention.test.ts`'s `seedRun` helper (with its `createdAt` override) is the model, and its retention case needs the force-settled row created older than the 50 newer terminal rows.
- For the active-run case, reuse `startRunDirect` + `createFakeWriteLoopExecutor` as `daemon-start-list.test.ts` does, and assert `fakeExecutor.isAbortSignalTriggered()`.
- Boundary-terminal rows for the refusal case can be seeded via `createRun({ status: "completed" | "blocked" | "failed" })`; assert `loadRun(...).finishedAt` is unchanged (null for a row created terminal without a durable transition).
- Add no test-only inversion hooks; every directive must mutate the real handler guard.
