# Completion-boundary fallback stamps terminal `finished_at`

## Problem

`StateStore.commitCompletionBoundary` routes terminal `runStatus` with settlement evidence through settlement writes that stamp `finished_at`; without evidence it uses a fallback `UPDATE` that sets `status` and `status_changed_at` only. Terminal rows from that path keep `finished_at` null while attempt `completed_at` is set, so retention and incident-candidate queries that key on run `finished_at` misclassify them. `state-store.test.ts` pins the null contract in `commitCompletionBoundary with no settlement evidence at all skips the settlement write path`.

## Decision ledger

- When `runStatus` is terminal and `extractTerminalSettlementEvidence` is undefined, the fallback run-row `UPDATE` sets `finished_at` to the same `Date.now()` value as `status_changed_at` in one statement; rules out a separate settlement hop or leaving `finished_at` null on that path.
- When `runStatus` is nonterminal, the fallback `UPDATE` stays status-only (no `finished_at` column write); rules out stamping terminal finish metadata on progress boundaries.
- Settlement-backed terminal boundaries keep the existing branch unchanged; rules out re-threading evidence-free terminal writes through `writeTerminalSettlementEvidence`.

## Task checklist

- Extend the fallback `UPDATE` in `commitCompletionBoundary` (`v2/src/persistence/state-store.ts`) to bind `finished_at` when `isTerminalRunStatus(args.runStatus)`.
- Update `commitCompletionBoundary with no settlement evidence at all skips the settlement write path` in `state-store.test.ts`: keep settlement-path skipped assertions, expect non-null `finishedAt` on the terminal row.
- Add or extend a `state-store.test.ts` case that commits a nonterminal completion boundary and asserts `finishedAt` stays null (e.g. extend `multiple attempts on a run are recorded correctly`).
- Revise `v2/docs/state-store.md` (`commitCompletionBoundary` bullet and finish-source paragraph): terminal completion-boundary writes always stamp run `finished_at`, including the no-evidence fallback; drop the null-by-design exception.
- Revise `v2/docs/v1-behaviors.md` additive bullet on execution-owned `commitCompletionBoundary`: settlement path already stamped; record that the no-evidence fallback now stamps `finished_at` too; drop null-by-design.

## Acceptance criteria

- [ ] `state-store.test.ts` test `commitCompletionBoundary with no settlement evidence at all skips the settlement write path` asserts non-null `finishedAt` on a terminal boundary without settlement evidence while still proving the settlement write path was skipped; it fails against the pre-fix fallback `UPDATE` reachable on main via that test's `expect(loaded.finishedAt).toBeNull()`.
- [ ] `state-store.test.ts` proves a nonterminal `commitCompletionBoundary` leaves `finishedAt` null; it fails if the fallback stamps `finished_at` for every boundary (constructible on main by applying terminal fallback stamping to the nonterminal `runStatus: "in-progress"` path in `multiple attempts on a run are recorded correctly`).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — document that terminal completion-boundary run updates always stamp `finished_at`, including the no-settlement-evidence fallback; remove finish-source null-by-design language for that path.
- `v2/docs/v1-behaviors.md` — update the execution-owned `commitCompletionBoundary` / `finished_at` baseline bullet per the decision ledger.
