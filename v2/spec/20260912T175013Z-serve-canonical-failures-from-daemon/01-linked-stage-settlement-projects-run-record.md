# Linked stage settlement projects the entry run's record

## Problem

`failureDetailFromLogs` in `v2/src/daemon/stage-settlement-owner.ts` composes a `RunOperatorError` from the entry run's terminal logs and stores it as the stage's `failureDetail`. Terminal intent, plan, and implement stages therefore show composer output, not the `OperatorFailureRecord` the run settled, so a stage's diagnosis can disagree with its own run row.

## Behavior

When a terminal workflow stage settles from its linked entry run, the stage's `failureDetail` is that run's stored `OperatorFailureRecord` unchanged. Runs with no record (or a corrupt column) keep the existing log-composed detail, so legacy rows lose nothing.

## Decisions

- Prefer the entry run's `operatorFailureRecord` over log composition, falling back to the composer only when the column is null or corrupt; rules out both silently dropping legacy detail and keeping the composer authoritative.
- Write the record as the whole `failureDetail` with no wrapper, matching `commitTerminalStageOperatorFailureRecord`; rules out an envelope that readers would have to unwrap differently per path.
- Keep `settleLinkedStagesFromEntryRun`'s `failureDetail` option opaque at the store boundary; rules out duplicating record typing into the persistence settlement API for one caller.
- A single `run.operatorFailureRecord == null` check already covers the corrupt case: the store nulls the column and sets `operatorFailureRecordCorrupt` separately on parse failure, so no extra flag check is needed here — deliberately diverges from subspec 00, which omits `failure` on both null and corrupt rows for the same underlying null value but names the corrupt case explicitly for its own field-presence contract.

## Task checklist

- [ ] In `v2/src/daemon/stage-settlement-owner.ts`, source the settled detail from the entry run's durable record, falling back to `composeRunOperatorError`.
- [ ] Tests covering intent, plan, and implement stages plus the legacy-fallback case.

## Acceptance criteria

- [ ] A test proves a terminal intent stage's `failureDetail` deep-equals its entry run's stored `OperatorFailureRecord`; it fails against the pre-fix composer-derived detail.
- [ ] A test proves the same identical projection holds for terminal plan and implement stages settled from their entry runs.
- [ ] A test proves an entry run with no stored record still settles its stage with the log-composed detail (fallback preserved).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — terminal workflow-stage `failureDetail` projects the linked entry run's record.
- `v2/docs/v1-behaviors.md` — record the changed v2 stage-settlement failure detail.
