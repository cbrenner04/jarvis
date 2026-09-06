# Fan-out lane failure incidents

## Primary implementation surface

Daemon: `collectPipelineIncidents` and `previewPipelineIncidentKeys` in `v2/src/daemon/operator-incidents.ts`.

## Problem

`collectPipelineIncidents` derives stage-scoped incidents for `stage-settlement-wedged` on live pipelines and suppresses failed-stage entry-run invocations only when the pipeline is terminal. A fan-out lane whose stage settles `failed` while sibling lanes keep the pipeline non-terminal therefore emits no operator incident carrying its `branchKey` — the failure is silent behind the next lane's gate (#3374).

## Decision ledger

- Derive a stage-scoped operator incident when `stage.status === "failed"` and the pipeline derived state is non-terminal; rules out relying on pipeline-level terminal incidents alone for fan-out lane failures.
- Do not emit that stage-scoped failed-lane incident when pipeline derived state is terminal; rules out duplicating `pipeline-terminal` / `addSuppressedInvocationForFailedStage` coverage.
- Use `kind: "stage-failed"` and `transition: "failed"` on the new incident; rules out deferring closed-union `OperatorIncidentKind` and delivery-ledger key shape.
- Carry `branchKey`, `stageId`, and `pipelineId` on that incident; rules out pipeline-only incidents that omit the failing lane.
- Suppress duplicate entry-run terminal incidents for the failed stage's invocation when the stage incident is emitted, matching the terminal-pipeline suppression path; rules out duplicate run-level noise alongside the stage incident.
- `stage-settlement-wedged` and `stage-failed` are mutually exclusive on one stage row (`running` deferred settlement vs `failed` settlement) and may both appear on the same live pipeline for different branch rows independently; rules out one suppressing the other.

## Tasks

- Extend `OperatorIncidentKind` with `stage-failed`.
- Extend `collectPipelineIncidents` to emit a stage-scoped incident (`kind: "stage-failed"`, `transition: "failed"`) for `failed` stages on non-terminal pipelines, including `branchKey`, and suppress the failed stage's entry-run terminal incident.
- Extend `previewPipelineIncidentKeys` so delivery-ledger skip semantics cover the new incident keys.
- Add `operator-notification.test.ts` regression `derives stage incident with branchKey for failed fan-out lane on live pipeline`: fan-out pipeline with two branch rows at the same stage, one `failed` and one still `running` or `awaiting`, pipeline derived state non-terminal; assert `deriveOperatorIncidents` includes an incident with the failed lane's `branchKey`.
- Add `operator-notification.test.ts` regression `suppresses entry-run terminal incident when failed fan-out lane emits stage incident on live pipeline`: same non-terminal fan-out fixture; assert only the stage-scoped incident remains for the failed lane's invocation.

## Acceptance criteria

- [x] `operator-notification.test.ts` test `derives stage incident with branchKey for failed fan-out lane on live pipeline` asserts a fan-out lane whose stage settles `failed` while sibling lanes keep the pipeline non-terminal appears in `deriveOperatorIncidents` with its `branchKey`; it fails against the current pipeline-level-only derivation.
- [x] `operator-notification.test.ts` test `suppresses entry-run terminal incident when failed fan-out lane emits stage incident on live pipeline` asserts the failed lane's entry-run terminal incident is absent when the stage-scoped incident emits on a non-terminal pipeline; it fails against the current run-level-only derivation.
- [x] `operator-notification.test.ts` — `a single failed stage produces one incident across stage, entry-run, and step-run rows` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to `02`–`04`.
