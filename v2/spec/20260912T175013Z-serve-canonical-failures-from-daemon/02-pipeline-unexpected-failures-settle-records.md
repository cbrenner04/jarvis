# Unexpected and resolution stage failures settle records

## Problem

Pipeline execution still writes free-form `failureDetail: { message }` when a stage fails outside linked-run settlement: the approval-boundary write failure, the workflow-stage resolution failure, the unexpected throw around stage execution, the stranded-pipeline sweep (`v2/src/daemon/pipeline-execution.ts`), and dispatch refusals (`v2/src/daemon/pipeline-stage-dispatch.ts`). The operator gets a bare message with no expectation, no retryability, and no path origins, so `{ message }` remains a competing terminal contract.

## Behavior

Every terminal stage failure these paths settle carries an `OperatorFailureRecord`: what the path expected, what it observed (the error text), honest `retryable`, and referenced paths with origins. Nonterminal coordination markers stay out of the contract — the reopened-stage reset marker written onto `pending` rows is unchanged.

## Decisions

- One shared helper builds these records from (expectation, observed error), living in a new `v2/src/daemon/pipeline-stage-failure-record.ts` rather than in `pipeline-execution.ts`; rules out a helper in `pipeline-execution.ts`, which already imports from `pipeline-stage-dispatch.ts` — a dispatch-side call into a `pipeline-execution.ts` helper would cycle back.
- Per-site `retryable`, honest to what a reissue can change: approval-boundary write failure (`settleApprovalBoundaryFailure`) `true` (the write, not the decision, failed); workflow-stage resolution failure (`resolution.ok === false` in the stage-advance path) `false` (the same pipeline definition resolves to the same error again); unexpected throw around stage execution (both the `pipeline-execution.ts` catch site and `pipeline-stage-dispatch.ts`'s) `true`; stranded-pipeline sweep (`failStrandedPipelineStage`) `true`; dispatch refusals `true`. Rules out a blanket value that either hides resumable work or invites a repeat of a fixed-point resolution error.
- Stage failures with no inspected path emit `referencedPaths: []` rather than inventing one; rules out labeling a synthetic path as `harness-internal`.
- Leave the reopened-stage reset marker (`isReopenedStageResetMarker`) as-is on `pending` rows; rules out presenting deferred-settlement bookkeeping as a terminal diagnosis.
- Leave `v2/src/daemon/pipeline-stage-recovery.ts` coded recovery-attempt details alone; rules out folding recovery's own `code`-keyed envelopes into this change (they are already structured and read by recovery tests).
- Leave run-level `daemonFailureDetail` (`v2/src/daemon/daemon-run-control-context.ts`, its four call sites) alone; rules out folding the run-level `{ failureKind, bindingAttempts, message }` invocation-failure contract into this pipeline-stage change — it is a different type on a different row.

## Task checklist

- [ ] Add the record builder in the new module and convert the `{ message }` settlement sites in `v2/src/daemon/pipeline-execution.ts`.
- [ ] Convert the dispatch-failure settlement sites in `v2/src/daemon/pipeline-stage-dispatch.ts`.
- [ ] Tests asserting record shape and the per-site `retryable` value for each converted site.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` gains a test proving a stage failed by an unexpected throw settles a `failureDetail` that parses as a complete `OperatorFailureRecord` with the thrown text in `observation` and `retryable: true`; it fails against the pre-fix `{ message }` detail.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` gains a test proving a workflow-stage resolution failure settles `retryable: false`; it fails against the pre-fix `{ message }` detail, which carries no retryability at all.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` gains a test proving a refused dispatch settles the same record contract with `retryable: true`; it fails against the pre-fix `{ code, message }` detail.
- [ ] `v2/src/daemon/pipeline-execution.test.ts`'s `"reconstructs failed-plan reset policy after a lost resume claim"` test (`describe("reopened pipeline continuation")`) stays green: the reset marker's `failureDetail` still matches `{ code: "pipeline_reopened_stage_reset", stageId, branchKey, flags }`, not an `OperatorFailureRecord`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — record contract for unexpected/resolution stage failures and the excluded nonterminal markers.
- `v2/docs/v1-behaviors.md` — record the changed v2 stage failure-detail contract.
