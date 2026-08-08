# Run finish timestamp on terminal status writes

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`setRunStatus(runId, status)` writes `UPDATE runs SET status = ?` and nothing else; `commitGuardedKill` writes `UPDATE runs SET status = 'killed'` and nothing else. A run driven terminal through either path — the spawn-boundary failure shape at `v2/src/daemon/daemon.ts:2226`, which has no attempt row and no `reconciledAt` — carries no finish timestamp anywhere in the store. Only `commitCompletionBoundary` (attempt `completed_at`) and `beginRunReconciliation` (`reconciled_at` / attempt `completed_at`) record one today.

## Decision ledger

- New nullable `runs.finished_at`, exposed as `Run.finishedAt`, stamped by the store at the durable terminal transition. Rules out deriving a finish at read time from `created_at` or attempt rows.
- `setRunStatus` writes `finished_at` on every call: `Date.now()` for a status in `TERMINAL_RUN_STATUSES`, `NULL` otherwise. Rules out leaving the column untouched on a non-terminal write, which would leave a resumed run (`setRunStatus(runId, "in-progress")`, `v2/src/execution/write-loop.ts:901`) carrying the finish stamp of its previous terminal state.
- Terminality is `isTerminalRunStatus`, not `isBoundaryTerminalRunStatus` — `killed` and `interrupted` must stamp.
- `commitGuardedKill` stamps inside its existing transaction, after the boundary-terminal guard, so a guarded no-op leaves the column as stored. Rules out stamping before the guard, which would give a `completed` row a kill-time finish.
- `commitCompletionBoundary` is not re-plumbed: attempt `completed_at` stays the finish source for boundary-committed rows, so `finishedAt` reads `null` on a run that only ever went terminal through a boundary. Rules out a second write on the same transition, which would make two durable sources disagree; the run column covers exactly the transitions that record nothing today.
- `createRun`'s optional `status` override is not stamped — admission creates only `in-progress` and `queued` rows.
- Migration appends as `023-run-finished-at`, no backfill; pre-migration rows read `null`.

## Prerequisites

- `setRunStatus` and `commitGuardedKill` write run status with no timestamp (`v2/src/persistence/state-store.ts`).
- `isTerminalRunStatus` / `TERMINAL_RUN_STATUSES` and `isBoundaryTerminalRunStatus` are exported from the same file.
- `RUN_COLUMNS` + `mapRunRow` project run columns onto `Run` by spread, so a new aliased column flows through without a mapper change.

## Tasks

- `v2/src/persistence/state-store.ts`:
  - Append `{ id: "023-run-finished-at", up: "ALTER TABLE runs ADD COLUMN finished_at INTEGER" }` to `SCHEMA_MIGRATIONS`.
  - `Run` gains `finishedAt?: number | null` (documented: Unix epoch ms of the last durable terminal status write outside a completion boundary); `RUN_COLUMNS` gains `finished_at AS finishedAt`.
  - `setRunStatus` body becomes `const finishedAt = isTerminalRunStatus(status) ? Date.now() : null;` then `this.db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(status, finishedAt, runId);` — the ternary is the keystone and clear-guard anchor and must stay on one physical line.
  - `commitGuardedKill`'s kill write becomes `const finishedAt = Date.now();` then `this.db.prepare("UPDATE runs SET status = 'killed', finished_at = ? WHERE id = ?").run(finishedAt, runId);` — `.run(finishedAt, runId);` is the kill guard anchor and occurs exactly once in the file.
- Tests — add to `v2/src/persistence/state-store.test.ts`:
  - `setRunStatus stamps a finish timestamp on a terminal status`: seed a run, record no attempt, `setRunStatus(runId, "failed")`, assert `finishedAt` is a number at or after a captured `before` bound while `attempts` is empty and `reconciledAt` is null; repeat over every `TERMINAL_RUN_STATUSES` member on separate branches. Carries the keystone `// @mutate`.
  - `setRunStatus clears the finish timestamp when a run leaves a terminal status`: drive `failed` then `in-progress`, assert `finishedAt` is null. Carries the clear-guard `// @mutate`.
  - `commitGuardedKill stamps a finish timestamp on the killed row`: assert a killed row's `finishedAt` is non-null, and that a `completed` row left untouched by the guard keeps `status: "completed"` with `finishedAt` null. Carries the kill-guard `// @mutate`.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` — `setRunStatus stamps a finish timestamp on a terminal status` drives a run to a terminal status through `setRunStatus` alone (no attempt row, `reconciledAt` null) and asserts a non-null `finishedAt` on the loaded run for every terminal status; it fails against the pre-fix code, which persists no finish timestamp on that path.
- [ ] `v2/src/persistence/state-store.test.ts` — `commitGuardedKill stamps a finish timestamp on the killed row` asserts the killed row carries a non-null `finishedAt`, and that a boundary-terminal row the guard skips keeps its status with `finishedAt` null.
- [ ] `v2/src/persistence/state-store.test.ts` — `setRunStatus clears the finish timestamp when a run leaves a terminal status` asserts `finishedAt` is null after `failed` → `in-progress`, so a resumed run carries no stale finish.
- [ ] `v2/src/persistence/state-store.test.ts` — `setRunStatus stamps a finish timestamp on a terminal status`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "isTerminalRunStatus(status) ? Date.now() : null" -> "null"` inside the test body — baseline semantics where a terminal status write records no finish time — and the mutation turns that regression RED.
- [ ] `v2/src/persistence/state-store.test.ts` — `setRunStatus clears the finish timestamp when a run leaves a terminal status`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "isTerminalRunStatus(status) ? Date.now() : null" -> "Date.now()"` inside the test body — stamping every status write, terminal or not — and the mutation turns that regression RED.
- [ ] `v2/src/persistence/state-store.test.ts` — `commitGuardedKill stamps a finish timestamp on the killed row`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts ".run(finishedAt, runId);" -> ".run(null, runId);"` inside the test body — a kill write that records no finish time — and the mutation turns that regression RED.
- [ ] Existing `commitGuardedKill` tests (`sets killed for non-boundary-terminal statuses`, `preserves boundary-terminal statuses`, `a completion boundary committed after kill wins over the kill write`) stay green.
- [ ] `v2/docs/state-store.md` documents `runs.finished_at`, the `023-run-finished-at` migration, and which store paths record which finish timestamp.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema — the `runs` bullet gains nullable `finished_at` (Unix epoch ms, stamped on a terminal status write outside a completion boundary, cleared on a non-terminal write); the forward-only list gains `023-run-finished-at` (no backfill, pre-migration rows read `null`).
- `v2/docs/state-store.md` § API — `setRunStatus` stamps `finished_at` for terminal statuses and clears it otherwise; `commitGuardedKill` stamps it on the killed row and leaves a guarded boundary-terminal row untouched.
- `v2/docs/state-store.md` § Semantics — the durable finish sources and which path writes each: run `finished_at` (`setRunStatus`, `commitGuardedKill`), attempt `completed_at` (`commitCompletionBoundary`), `reconciled_at` (orphan settlement); a boundary-committed run keeps `finished_at` null by design.
- `v2/docs/v1-behaviors.md` — record that the state store now stamps a run finish timestamp on every terminal `setRunStatus` and guarded-kill write and clears it when a run resumes to a non-terminal status.
