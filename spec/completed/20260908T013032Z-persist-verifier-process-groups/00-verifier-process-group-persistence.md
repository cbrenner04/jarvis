# 00 - Verifier process-group persistence

Module boundary: persistence (`v2/src/persistence/state-store.ts`).

`runs.ready_gate_pgid` holds one integer and `setReadyGatePgid` overwrites it, so a run that records a second verifier group silently drops the first. Finalization may hold more than one in-flight verifier group; durable storage and sweep-candidate listing must represent every recorded group without a parallel reaping path. Caller wiring (execution loop, daemon sweep) is deferred to follow-on intents; this subspec lands only the store shape and generalized record/list/clear API.

## Decision ledger

- Durable ids live in a child table `run_verifier_process_groups (run_id, pgid)` with `PRIMARY KEY (run_id, pgid)` and `FOREIGN KEY (run_id) REFERENCES runs(id)`; rules out retaining `ready_gate_pgid` as the only store.
- Baselined `SCHEMA` includes the child table; stores that already stamped `031-baseline-squash` create it on open when absent and backfill `INSERT` rows from every non-null `runs.ready_gate_pgid`; rules out leaving upgraded stores with an empty child table while the column still carries ids.
- `ready_gate_pgid` stays on `runs` as the ready-gate slot pointer so `setReadyGatePgid` replace/clear semantics stay gate-scoped; rules out `setReadyGatePgid(null)` calling `clearVerifierProcessGroups`, which would wipe concurrently recorded verifier groups.
- `recordVerifierProcessGroup(runId, pgid)` inserts one id without removing siblings; duplicate `(run_id, pgid)` is idempotent; rules out UPDATE-in-place on the runs row.
- `clearVerifierProcessGroup(runId, pgid)` deletes one `(run_id, pgid)` row and nulls `ready_gate_pgid` when it matches the cleared pgid; rules out whole-run clear for per-group settlement.
- `clearVerifierProcessGroups(runId)` deletes every child row for the run and nulls `ready_gate_pgid`; rules out reusing `setReadyGatePgid(runId, null)` as the only whole-run reset entry point for follow-on callers.
- `setReadyGatePgid` delegates to the child table: non-null replaces only the prior gate-slot pgid (`clearVerifierProcessGroup` for the old column value when set, then `recordVerifierProcessGroup` and column update); null clears only the gate-slot pgid via `clearVerifierProcessGroup` for the current column value; rules out gate replace clearing unrelated verifier pgids.
- `listReadyGateSweepCandidates` selects every child-table pgid joined to its owning run and applies the same `isOwnerAlive` probe as today; one result row per `(runId, pgid)`; return shape stays `{ runId, readyGatePgid }`; rules out age-based reaping and renaming the field before the daemon consumer lands.
- Caller wiring for `recordVerifierProcessGroup` and daemon per-group settlement is deferred; until a follow-on intent lands both, `setReadyGatePgid(null)` clears only the gate-slot pgid and leaves other recorded verifier pgids uncleared — follow-on intents that call `recordVerifierProcessGroup` must land per-group settlement (`clearVerifierProcessGroup`) or whole-run clear wiring before or with those callers; rules out assuming this subspec alone closes the daemon reap path for multi-recorded groups.

## Task checklist

- Add `run_verifier_process_groups` to baselined `SCHEMA` and post-squash open-time creation/backfill for existing stores.
- Add `recordVerifierProcessGroup`, `clearVerifierProcessGroup`, and `clearVerifierProcessGroups` to the `StateStore` interface and implementation.
- Rewire `setReadyGatePgid` and `listReadyGateSweepCandidates` to read/write the child table per the decision ledger.
- Add `state-store.test.ts` regressions for multi-record retention, per-group clear, whole-run clear, gate replace child eviction, squashed-store backfill, idempotent duplicate insert, and multi-group sweep listing.
- Update `state-store-baseline-migration.test.ts` fixture `CREATE` when the baselined table set changes.

## Acceptance criteria

- [x] `v2/src/persistence/state-store.test.ts` test `recordVerifierProcessGroup retains multiple ids per run` records two distinct pgids on one run, reopens the store, and asserts both pgids via raw SQL `SELECT pgid FROM run_verifier_process_groups WHERE run_id = ?`; it fails against single-column storage reachable on main via `records and replaces the in-flight ready-gate group id`.
- [x] `v2/src/persistence/state-store.test.ts` test `listReadyGateSweepCandidates returns every recorded verifier group for non-live owners` records multiple pgids on one dead-owner run and asserts the sweep listing includes one `{ runId, readyGatePgid }` row per recorded pgid; it fails against the pre-fix gate-column-only listing reachable on main via `listReadyGateSweepCandidates omits live owners and includes dead, null, and non-terminal rows`.
- [x] `v2/src/persistence/state-store.test.ts` test `clearVerifierProcessGroup removes one recorded id without disturbing siblings` records two pgids, clears one, and asserts the remaining pgid via raw SQL `SELECT pgid FROM run_verifier_process_groups WHERE run_id = ?`; it fails against the pre-fix code.
- [x] `v2/src/persistence/state-store.test.ts` test `clearVerifierProcessGroups removes every recorded id for a run` records multiple pgids, clears the run, reopens the store, and asserts zero child-table rows via raw SQL plus an empty sweep listing for that run; it fails against the pre-fix code.
- [x] `v2/src/persistence/state-store.test.ts` test `setReadyGatePgid replace evicts prior gate pgid from child table` records gate pgid A then replaces with B and asserts A is absent from `run_verifier_process_groups` via raw SQL while B remains; it fails when gate replace updates only `runs.ready_gate_pgid`.
- [x] `v2/src/persistence/state-store.test.ts` test `post-squash open backfills run_verifier_process_groups from ready_gate_pgid` opens a pre-squash fixture stamped `031-baseline-squash` with a non-null `ready_gate_pgid` and no child table, then asserts a matching child row after `openStateStore`; it fails when the child table stays empty while the column still holds the pgid.
- [x] `v2/src/persistence/state-store.test.ts` test `recordVerifierProcessGroup duplicate insert is idempotent` records the same pgid twice and asserts exactly one child-table row via raw SQL; it fails against the pre-fix code.
- [x] `v2/src/persistence/state-store.test.ts` — `records and replaces the in-flight ready-gate group id` stays green.
- [x] `v2/src/persistence/state-store.test.ts` — `clears the in-flight ready-gate group id on settlement` stays green.
- [x] `v2/src/persistence/state-store.test.ts` — `listReadyGateSweepCandidates omits live owners and includes dead, null, and non-terminal rows` stays green.
- [x] `v2/docs/state-store.md` documents the child table, `recordVerifierProcessGroup` / `clearVerifierProcessGroup` / `clearVerifierProcessGroups` semantics, gate-slot `setReadyGatePgid` delegation, and generalized `listReadyGateSweepCandidates` sweep-candidate listing.
- [x] `v2/docs/v1-behaviors.md` — the ready-gate/required-integration process-group bullet (~557) is updated or split so multi-group durable storage, gate-slot pointer semantics (`ready_gate_pgid` as current gate slot, not sole store), and sweep-candidate listing (every recorded group for a non-live owner) are internally consistent; contradictory "at most one" gate/integration pgid and daemon `setReadyGatePgid(runId, null)`-only clear prose is removed or scoped to the gate slot.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — multi-group verifier process-group storage, record/clear semantics, gate-slot delegation, and sweep-candidate listing (see acceptance criterion).
- `v2/docs/v1-behaviors.md` — reconcile the ~557 process-group bullet per acceptance criterion.
