# Force-settle a non-active run on the kill RPC

## Problem

`killHandler` (`v2/src/daemon/daemon.ts`) settles only rows with a matching `activeRuns` entry; every other row gets `run_not_active` with no write. A `paused` row whose loop is gone — including one `resume` refuses with `unsupported_resume_context` — is therefore neither resumable nor killable. `paused` is not terminal, so `retainListedRuns` never ages it out of the 50-newest-terminal window and it paints in `run list` and the TUI work tree forever (observed 2026-08-16 on two 2026-08-11 rows for `20260811T173344Z-tui-left-pane-width-and-timing-threshold`). Startup reconciliation cannot reach it: `beginRunReconciliation` settles only rows whose owner process is dead, and this row's owner is the live daemon.

`activeRuns` is per-daemon and per-`(project, branch)`, but durable rows are shared across every keyed daemon under one `JARVIS_HOME`, and `owner_identity` is stamped by `createRun` for daemon admission, foreground `jarvis write`, and the workflow runner alike. "No `activeRuns` entry on this daemon" therefore does not mean "no loop anywhere" — it can mean the loop belongs to a sibling daemon or a live foreground writer. Force must settle a row whose owner is this process or provably dead; it must refuse a row whose owner is a different still-live process.

## Decision ledger

- Force is an optional `force?: boolean` param on the existing `kill` RPC; rules out a new RPC verb that the wire docs, tui client, and CLI would each have to learn.
- Force admissibility is two independent guards, both must pass: (a) status — `force === true` ∧ the durable row is **non-terminal** (`isTerminalRunStatus`); (b) owner — the row's `owner_identity` is `NULL` (pre-migration row, treated as ownerless the same way reconciliation does), equals the current process's identity (no `activeRuns` entry then genuinely proves no in-memory loop — the motivating case, a `paused` row owned by the live current daemon), or names a different process that `isOwnerAlive` reports dead. A different still-live owner refuses. This deliberately does **not** reuse `beginRunReconciliation`'s discriminant verbatim: reconciliation skips rows owned by the current process, which is exactly the row this spec exists to settle.
- The status guard tightens the intent's "non-boundary-terminal" to **non-terminal**: forcing an already-`killed` row is a no-op under the intent's wording (`commitGuardedKill` boundary-terminal guard already refuses it), but the intent's admissibility check alone doesn't say so — recorded explicitly here so a force attempt against an already-`killed` row does not restamp `finished_at` and move its retention/`finishedAtMs` window. `interrupted` is already boundary-terminal, so `killed` is the only status the tightened guard adds over "boundary-terminal"; this is a wording clarification, not a coverage change.
- The owner guard is a new persistence read: today `owner_identity` is not exposed on the `Run` type or `RUN_COLUMNS` and is read only internally by reconciliation (`v2/docs/state-store.md`). This subspec adds a second internal consumer via a new `StateStore` method reusing the store's existing `currentIdentity`/`isOwnerAliveProbe` fields and the exported `isOwnerAlive` probe — one persistence-layer addition in service of the one daemon-RPC behavior; it does not become a second module boundary.
- The `activeRunAcceptsKill` branch keeps precedence over the force branch unconditionally: an active row takes the existing abort path whether or not `force` is set; rules out force becoming a way to skip a live loop's abort/checkpoint sequence.
- Force settles through `store.commitGuardedKill(runId)`; rules out deleting the row or writing `status = 'killed'` by hand with no finish timestamp, either of which breaks `finishedAtMs` projection and terminal retention.
- Force never consults resume admissibility; rules out gating on `unsupported_resume_context`, which would leave every other flavor of stuck non-active row unclearable and couple kill to resume's reconstruction logic.
- An inadmissible force call (status guard fails, or owner guard fails) returns the existing `run_not_active` error unchanged; rules out a new error code for "terminal, nothing to settle" or "owned elsewhere."
- Force settles status only: it releases no worktree claim and no `.jarvis.lock`, mirroring reconciliation's own "it does not reclaim worktrees" scope line.
- Named side effect on `start`, not just `kill`: flipping a non-terminal workflow step row to `killed` also satisfies `start`'s intent-ownership guard (`v2/src/daemon/daemon.ts`, the `worktree_claimed` check keyed on `!isTerminalRunStatus(existing.status)`), so a fresh workflow request for the same `(project, branch)` under a different `invocationId` — previously rejected `worktree_claimed` — is admitted once the prior row is force-settled. This is the desired effect of making the row terminal, not new logic in `start`; it's recorded here because it's an observable behavior change on a different RPC.
- Scope is the daemon RPC surface only: no `jarvis run kill --force` flag and no TUI affordance. CLI/TUI reachability is a deliberate follow-up, not silently dropped — see `index.md`.
- `pause`, `resume`, reconstruction, and startup reconciliation are untouched.

## Task checklist

- Add an exported `forceSettleStatusAdmitsRun(status: RunStatus): boolean` beside `activeRunAcceptsKill` in `v2/src/daemon/daemon.ts` — single-line body, the non-terminal guard only.
- Add a `StateStore` method (e.g. `forceKillOwnerAdmits(runId: string): Promise<boolean>`) implemented in `v2/src/persistence/state-store.ts`, reading `owner_identity` for the row and resolving true when it is `NULL`, equals `this.currentIdentity`, or names a dead owner per `this.isOwnerAliveProbe`; false for a different live owner. Mirror `beginRunReconciliation`'s per-identity liveness caching only if this becomes a hot path — a single-row read does not need it.
- Add an async `forceSettleAdmitsRun(store, runId, status, force)` in `v2/src/daemon/daemon.ts` composing the three guards as three separate single-line early-returns (force flag, then `forceSettleStatusAdmitsRun`, then the awaited `store.forceKillOwnerAdmits` result as the final `return`) so each guard is independently mutation-quotable.
- Widen `killHandler`'s params to `{ runId?: string; force?: boolean }`. After the `activeRunAcceptsKill` branch, gate the force branch on a single `if (await forceSettleAdmitsRun(store, runId, run.status, params?.force)) {`; on pass, `store.commitGuardedKill(runId)` and return `{ ok: true }`. Otherwise fall through to the unchanged `run_not_active` error.
- Add force coverage to `v2/src/daemon/daemon-start-list.test.ts`: non-active same-process settle, non-force rejection, active-run precedence, terminal rows unchanged, dead-foreign-owner settle, live-foreign-owner refusal (seed the foreign owner via a second `openStateStore(path, { currentIdentity })` instance against the same db file, the pattern `daemon-reconciliation.test.ts` uses) — with in-body `// @mutate` directives on the real guards.
- Seed every "terminal row must stay unchanged" case through a path that actually stamps `finished_at` (`setRunStatus`/`commitGuardedKill`, not bare `createRun({status})`, which leaves `finished_at` null); for the already-`killed` restamp case, capture `finishedAt` after seeding, wait past the process's clock resolution (e.g. a short real `setTimeout`) before issuing the forced kill, then assert `finishedAt` is unchanged — so a restamping mutation is observably different, not coincidentally equal.
- Add force-settled retention coverage to `v2/src/daemon/daemon-terminal-run-retention.test.ts`, driven through that file's own `handlers.kill` (its `beforeEach` already builds handlers; don't reach for `daemon-start-list.test.ts`'s local kill helper, which isn't shared), covering a workflow-invocation row with a non-terminal sibling.
- Update `v2/docs/daemon-host.md`, `v2/docs/state-store.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `daemon-start-list.test.ts` test `kill with force settles a non-active paused run` fails against the pre-fix code, then proves a `paused` row owned by the current process with no `activeRuns` entry responds `{ ok: true }` to `kill` with `force: true` and is durably `killed` with a non-null `finishedAt`.
- [x] `daemon-start-list.test.ts` test `kill without force still rejects a non-active paused run` proves the same row rejects `kill` with `run_not_active` when `force` is omitted, and stays `paused` with a null `finishedAt`.
- [x] `daemon-start-list.test.ts` test `kill with force on an active run still takes the abort path` proves an `activeRuns`-tracked run killed with `force: true` has its abort signal triggered and lands durably `killed`.
- [x] `daemon-start-list.test.ts` test `kill with force leaves terminal rows unchanged` proves `completed`, `blocked`, `failed`, and already-`killed` rows (each seeded through a path that stamps `finished_at`) respond `run_not_active` to `kill` with `force: true` and keep their recorded status and `finishedAt` exactly unchanged.
- [x] `daemon-start-list.test.ts` test `kill with force settles a row owned by a dead foreign process` proves a non-active, non-terminal row whose `owner_identity` names a different, no-longer-alive process responds `{ ok: true }` to `kill` with `force: true` and is durably `killed`.
- [x] `daemon-start-list.test.ts` test `kill with force refuses a row owned by a live foreign process` — reachable by seeding the row through a second `openStateStore` instance opened with a distinct `currentIdentity` against the same database, then killing through the handler's own store with an injected `isOwnerAlive` that reports that identity alive — proves `kill` with `force: true` responds `run_not_active` and leaves the row's status and `finishedAt` unchanged; it fails against a version of the owner guard that only checks local `activeRuns` absence.
- [x] `daemon-terminal-run-retention.test.ts` test `a force-settled workflow step ages out only once every sibling in its invocation is settled` proves: force-settling one non-terminal step row of a workflow invocation while a sibling step in that same invocation stays non-terminal leaves the force-settled row present in unfiltered `list` even behind fifty newer terminal rows; once every sibling in the invocation is also terminal, the whole invocation ages out behind fifty newer terminal rows. It fails against the pre-fix code, where the target row can never reach `killed` through `kill` at all.
- [x] `daemon-start-list.test.ts` — `kill with force settles a non-active paused run`; Keystone checkpoint: an in-body `// @mutate` directive that neuters `killHandler`'s `if (await forceSettleAdmitsRun(store, runId, run.status, params?.force)) {` to `if (false) {` restores baseline `run_not_active` for the non-active row, turning this test red while the other kill tests stay green.
- [x] `daemon-start-list.test.ts` — `kill without force still rejects a non-active paused run`; Mutation checkpoint: an in-body `// @mutate` directive neutering `forceSettleAdmitsRun`'s force-flag early-return (`if (force !== true) return false;`) to `if (false) return false;` so an absent `force` also admits makes the plain `kill` settle the row `killed`, turning this test red.
- [x] `daemon-start-list.test.ts` — `kill with force leaves terminal rows unchanged`; Mutation checkpoint: an in-body `// @mutate` directive neutering `forceSettleAdmitsRun`'s status early-return (`if (!forceSettleStatusAdmitsRun(status)) return false;`) to `if (false) return false;` makes force respond `{ ok: true }` on terminal rows and restamp the already-`killed` row's `finishedAt`, turning this test red.
- [x] `daemon-start-list.test.ts` — `kill with force on an active run still takes the abort path`; Mutation checkpoint: an in-body `// @mutate` directive widening `killHandler`'s `if (activeRunAcceptsKill(activeRun, runId)) {` to exclude forced calls (e.g. `&& params?.force !== true`) routes an active run to force settlement without aborting its loop, turning this test red.
- [x] `daemon-start-list.test.ts` — `kill with force refuses a row owned by a live foreign process`; Mutation checkpoint: an in-body `// @mutate` directive neutering `forceSettleAdmitsRun`'s final `return store.forceKillOwnerAdmits(runId);` to `return true;` admits a live-foreign-owner kill, turning this test red.
- [x] Existing kill coverage stays green: `daemon-start-list.test.ts` tests `kill aborts an active run and records killed status`, `kill rejects unknown run ID`, `kill preserves boundary-terminal status on an active run but still aborts`, `kill still sets killed on a paused run`, and `daemon-workflow-start.test.ts` workflow kill tests are unchanged by the added branch.
- [x] `v2/docs/daemon-host.md` — the `kill` RPC row records the `force?: boolean` param, that force settles a non-active non-terminal row durably `killed` with a finish timestamp via the same guarded write when the row's owner is this process or provably dead (refusing a different still-live owner), that an active row still takes the abort path regardless of `force`, that terminal rows (including `killed`) reject with `run_not_active` and are left untouched, and that a force-settled row is an ordinary terminal row for retention and `finishedAtMs`; the restart-reconciliation section's `paused` "remains killable" sentence is corrected to distinguish the active-abort path from forced settlement; § Live controls on workflow-started runs records that non-live workflow rows reject `kill` with `run_not_active` unless `force` is set, in which case a non-terminal row settles durably outright rather than deferring to invocation quiescence; the `start` RPC row notes that a force-settled prior row no longer blocks a fresh request for the same `(project, branch)` under a different invocation.
- [x] `v2/docs/state-store.md` — records the new `owner_identity`-reading `StateStore` method backing force-kill's owner guard (a second internal consumer alongside reconciliation), and its admission rule (unowned or dead-owned admits, live-foreign-owned refuses).
- [x] `v2/docs/v1-behaviors.md` records the v2-only force-settlement path on daemon `kill` (non-active non-terminal rows only, owner-liveness guarded, guarded durable write, unchanged non-force and active-run behavior, no CLI flag).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `kill` RPC row (`force` param, status + owner admissibility, guarded durable write, terminal-row rejection, retention/`finishedAtMs` equivalence); restart-reconciliation section (`paused` killability split between active-abort and forced-settlement); § Live controls on workflow-started runs (non-live rows reject unless forced, forced settle is durable-outright); `start` RPC row (force-settled prior row unblocks a fresh request for the same `(project, branch)` under a different invocation).
- `v2/docs/state-store.md` — new owner-liveness-reading `StateStore` method backing force-kill; update the "read only internally by reconciliation" line to name the second consumer.
- `v2/docs/v1-behaviors.md` — v2-only bullet for daemon `kill` force settlement.

## Implementer notes

- Suggested production shape (adjust names, keep each guard as its own single-line statement so it stays independently quotable):

  ```ts
  async function forceSettleAdmitsRun(
    store: StateStore,
    runId: string,
    status: RunStatus,
    force: boolean | undefined,
  ): Promise<boolean> {
    if (force !== true) return false;
    if (!forceSettleStatusAdmitsRun(status)) return false;
    return store.forceKillOwnerAdmits(runId);
  }
  ```

  and in `killHandler`, immediately after the `activeRunAcceptsKill` block:

  ```ts
  if (await forceSettleAdmitsRun(store, runId, run.status, params?.force)) {
    store.commitGuardedKill(runId);
    return { kind: "response", result: { ok: true } };
  }
  ```

  Each of the four lines — the `if (await forceSettleAdmitsRun(...))` keystone line and the three guard lines inside `forceSettleAdmitsRun` — is then unique in the file and independently quotable by one `@mutate` directive, alongside the unchanged `if (activeRunAcceptsKill(activeRun, runId)) {` line already at that call site.
- `isTerminalRunStatus` is already imported in `daemon.ts`; `commitGuardedKill`'s own boundary-terminal guard stays as defense in depth even though the status guard already excludes those rows.
- `CURRENT_OWNER_IDENTITY` and `isOwnerAlive` are already exported from `v2/src/persistence/state-store.ts`; the new `StateStore` method should reuse the instance's own `currentIdentity`/`isOwnerAliveProbe` (already injectable via `openStateStore(path, { currentIdentity, isOwnerAlive })`, the pattern `daemon-reconciliation.test.ts` uses) rather than importing the module-level singleton, so tests can inject both a foreign owner and a controllable liveness answer.
- Seed non-active same-process rows with `stateStore.createRun({ ..., status })` (the shape `daemon-terminal-run-retention.test.ts`'s `seedRun` uses) rather than `startRunDirect`, which registers an `activeRuns` entry; `loadRunOrThrow(stateStore, runId).finishedAt` reads the durable finish timestamp.
- Add no test-only inversion hooks; every directive must mutate the real daemon or state-store guard.
