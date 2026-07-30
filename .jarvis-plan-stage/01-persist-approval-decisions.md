# Persist approval decisions

## Problem

- Approval stages have no durable boundary vocabulary or atomic decision operation, and reconciliation treats
  unfamiliar statuses as abandoned active work.

## Decisions

- Store `awaiting`, `approved`, and `rejected` on the approval stage row; rules out a paused workflow run or
  pipeline-wide approval flag.
- Change only the matching stage from `pending` to `awaiting`, then from `awaiting` to one decision in an atomic
  conditional write; rules out wrong-stage, duplicate, and last-writer-wins settlement.
- Treat all three approval statuses as reconciliation-stable and leave pipeline-level orphan settlement
  unchanged; rules out interrupting the gate and leaving a dead owner's pipeline row active.
- Deferred to first consumer: repository result payload and decision timestamps — pin when daemon approval needs
  them.

## Task checklist

- Add conditional approval-boundary and decision repository operations.
- Preserve approval statuses during pipeline reconciliation.
- Add focused close/reopen, competing-writer, negative-case, and reconciliation regressions.
- Update persistence, reconciliation, and v2 behavior docs.

## Acceptance criteria

- [ ] Closing and reopening the store preserves an approval row under the same durable stage ID in each explicit
      `awaiting`, `approved`, and `rejected` state.
- [ ] Marking an approval boundary changes only the matching `pending` stage to `awaiting`; a decided or otherwise
      non-pending stage is unchanged.
- [ ] Two store handles deciding the same awaiting stage admit exactly one `approved` or `rejected` transition;
      duplicate, losing-race, wrong-stage, and non-awaiting decisions change no row.
- [ ] Restart reconciliation leaves `awaiting`, `approved`, and `rejected` rows unchanged, including prior
      `succeeded` and later `pending` siblings.
- [ ] New or updated `v2/src/persistence/state-store.test.ts` regressions for durable approval transitions and
      reconciliation fail against the pre-fix store.
- [ ] Inverting the pending-boundary, awaiting-decision, or reconciliation-stability guard makes its targeted
      `v2/src/persistence/state-store.test.ts` regression fail; negative cases prove suppressed writes are absent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document approval
      persistence and restart semantics in their durable homes.

## Documentation updates

- `v2/docs/state-store.md` — approval vocabulary and conditional repository operations.
- `v2/docs/daemon-host.md` — restart reconciliation preserves durable approval boundaries.
- `v2/docs/v1-behaviors.md` — additive v2 durable approval state and first-decision-wins behavior.
