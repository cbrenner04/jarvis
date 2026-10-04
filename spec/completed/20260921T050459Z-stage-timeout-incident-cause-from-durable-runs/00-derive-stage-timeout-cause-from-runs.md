# Derive stage timeout cause from attributed durable runs

## Problem

Linked-stage settlement preserves a failing run's `OperatorFailureRecord`, which has no `terminalCause`. Incident derivation still reads `stage.failureDetail.terminalCause`, so timeout-settled stages report `failed`.

## Decisions

- Resolve a failed stage's entry run from `workflowInvocationId`, then inspect every durable row sharing that run's workflow invocation id; rules out reading timeout cause from canonical stage failure detail or only the entry row.
- Any attributed row with `terminalCause: "run_timeout"` makes the stage cause `run_timeout`, regardless of other non-timeout failures; rules out row-order or rollup-cause precedence.
- Timeout rows from a different invocation do not affect the stage cause; rules out project-wide timeout attribution.
- Missing entry runs, missing invocation ids, and invocations with no timeout row yield `failed`; rules out inference from stage prose, status, or unrelated durable rows. A resolved entry run with an invocation id always contributes its own row, so an empty attributed set is unreachable and gets no separate case.
- Keep linked-stage settlement and `failureDetail` byte-for-byte semantics unchanged; rules out restoring a wrapper around `OperatorFailureRecord` or adding `terminalCause` to the shared record.
- Use the same derived cause for non-terminal `stage-failed` and terminal `pipeline-terminal` incidents; rules out fixing only one notification altitude.

## Task checklist

- [ ] Change `v2/src/daemon/operator-incidents.ts` to derive each failed linked stage's cause from its entry run and full durable invocation row set.
- [ ] Add focused settlement-to-incident regression cases in `v2/src/daemon/operator-incidents.test.ts` for both incident paths, timeout precedence and isolation, reachable fallback, and unchanged canonical failure detail.
- [ ] Update the linked-stage timeout notification contract in `v2/docs/daemon-host.md` and the corrected v2 behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `v2/src/daemon/operator-incidents.test.ts` test `a linked stage settled without log records derives timeout cause from durable invocation rows` settles a timeout failure carrying an `OperatorFailureRecord` through `settleStagesForEntryRun` without `loadLogRecords`, asserts both `stage-failed` and `pipeline-terminal` incidents have cause `run_timeout`, and fails against the pre-fix `stage.failureDetail.terminalCause` read.
- [x] `v2/src/daemon/operator-incidents.test.ts` proves an attributed invocation containing both timeout and non-timeout failed rows derives `run_timeout` in both `stage-failed` and `pipeline-terminal` incidents independent of row order.
- [x] `v2/src/daemon/operator-incidents.test.ts` proves a timeout row from a different invocation does not affect the cause: a stage whose own invocation has only non-timeout rows derives `failed` in both incidents. This pins isolation, not the pre-fix regression.
- [x] `v2/src/daemon/operator-incidents.test.ts` proves an invocation containing only non-timeout rows and failed stages with an absent entry run or absent invocation id derive `failed` in both `stage-failed` and `pipeline-terminal` incidents.
- [x] The no-log settlement regression asserts the settled stage's `failureDetail` deep-equals the stored `OperatorFailureRecord` with no added fields.
- [x] Existing `v2/src/daemon/operator-incidents.test.ts` incident-kind, transition, suppression, project, and serialization cases stay green.
- [x] `v2/docs/daemon-host.md` states that linked-stage timeout incident causes come from any durable row sharing the admitted entry run's invocation id, timeout overrides non-timeout rows, unresolved attribution falls back to `failed`, and canonical stage failure detail remains unchanged.
- [x] `v2/docs/v1-behaviors.md` records the corrected v2 linked-stage timeout incident derivation.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — replace the stale failure-detail-derived timeout notification rule with durable invocation-row attribution and fallback semantics.
- `v2/docs/v1-behaviors.md` — record the corrected v2 incident cause without changing settlement or failure-record contracts.
