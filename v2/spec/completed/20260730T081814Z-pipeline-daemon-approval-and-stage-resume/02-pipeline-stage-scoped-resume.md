# Stage-scoped pipeline resume

## Problem

- Failed and awaiting pipelines stop at durable boundaries, but no daemon-owned operation re-enters the eligible stage without restarting the pipeline or silently succeeding on terminal work.

## Prerequisites

- `reopenFailedPipeline` atomically reopens a valid failed-plus-skipped-suffix shape in place (`v2/spec/20260730T043255Z-pipeline-durable-approval-and-reopen-state/06-reopen-failed-pipeline-in-place.md`).
- `continuePipeline` re-dispatches only the eligible continuation row and preserves succeeded predecessor invocation IDs and artifacts (`pipeline-execution.test.ts`).
- Daemon-owned approval decisions from [00 - Daemon-owned approval decisions](./00-pipeline-approval-decisions.md).

## Decisions

- Add `pipeline_resume { pipelineId }` as the sole daemon-owned stage-scoped resume entry point; rules out translating resume into `pipeline_start` or run-level `resume`.
- For a derived `failed` pipeline, `pipeline_resume` calls `reopenFailedPipeline` only when a `failed` row remains (reopen required before activation); when failure is already reopened (`reopenedFailurePermitsActivation` true, derived `pending`), skip reopen and continue via `continuePipeline`; rules out re-dispatching completed predecessors.
- For a derived `awaiting-approval` pipeline, `pipeline_resume` branches on `derivePipelineState === "awaiting-approval"` and may claim ownership via `claimPipelineContinuation` but must not call `continuePipeline` (`isPipelineContinuable` is false because derived state is not `pending` and `approvalOutcomePermitsActivation` blocks `awaiting` rows); startup `recoverContinuablePipelines` must not auto-activate awaiting pipelines — awaiting resume is explicit-only and preserves the gate row `awaiting` with no later dispatch; rules out fail-open continuation past `awaiting`.
- Resume on derived `succeeded` refuses `pipeline_terminal_succeeded`; resume on derived `rejected` refuses `pipeline_terminal_rejected`; rules out silent no-op on terminal pipelines.
- Resume on derived `running`, `pending`, or `interrupted` refuses `pipeline_not_resumable`; rules out implementer guesswork on in-flight or not-yet-failed shapes.
- When `reopenFailedPipeline` refuses (ineligible failed shape), `pipeline_resume` surfaces the store refusal reason (`no_failed_stage`, `multiple_failed_stages`, `malformed_continuation`, etc.) without dispatch.
- The handler returns after reopen and/or claim admission (or refusal) and detaches like `pipeline_start`; rules out client-held continuation.
- Mutating pipeline RPC retirement follows the same `daemon_superseded` guard as `pipeline_start`.

## Task checklist

- Add daemon-owned resume entry point in `pipeline-execution.ts` composing reopen eligibility, `reopenFailedPipeline`, terminal refusal, awaiting-only claim, and `continuePipeline`.
- Register `pipeline_resume` handler in `daemon.ts` with validation, async continuation, and focused handler coverage.
- Extend `v2/src/daemon/pipeline-execution.test.ts` for failed-only redispatch, awaiting preservation, distinct terminal and reopen refusals, post-reconcile resume, deferred-state refusal, and guard inversion.
- Document stage-scoped resume semantics and terminal refusal codes in `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [x] A regression in `v2/src/daemon/pipeline-execution.test.ts` fails on baseline and then proves `pipeline_resume` on a failed pipeline re-dispatches only the failed continuation stage while every prior stage `workflowInvocationId` stays unchanged, including when `reopenFailedPipeline` runs vs is skipped on an already-reopened failure.
- [x] The same regression file fails on baseline and then proves `pipeline_resume` on an `awaiting-approval` pipeline preserves `awaiting` on the gate, dispatches no later workflow stage, and does not rely on `isPipelineContinuable` or `recoverContinuablePipelines` treating the pipeline as continuable.
- [x] The same regression file fails on baseline and then proves resume on a completed pipeline returns `pipeline_terminal_succeeded` and on a rejected pipeline returns `pipeline_terminal_rejected`, each without stage dispatch.
- [x] The same regression file fails on baseline and then proves `pipeline_resume` on an ineligible failed shape (for example `multiple_failed_stages`) returns the matching `reopenFailedPipeline` refusal without stage dispatch.
- [x] The same regression file fails on baseline and then proves `pipeline_resume` on failed and `awaiting-approval` pipelines after store close/reopen (including post-reconcile `interrupted` ownership) continues or re-claims from persisted context without caller-supplied reconstruction.
- [x] The same regression file fails on baseline and then proves resume on derived `running`, `pending`, or `interrupted` returns `pipeline_not_resumable` without stage dispatch.
- [x] Inverting the failed-only redispatch, awaiting-no-dispatch, terminal-refusal, or deferred-state-refusal guard makes `v2/src/daemon/pipeline-execution.test.ts` fail; negative cases prove completed, rejected, and deferred-state resume attempts change no stage row and dispatch nothing.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_resume` RPC contract, failed reopen composition, awaiting re-entry without approval and without weakening `isPipelineContinuable`, predecessor preservation, named terminal and reopen refusals, and deferred-state refusal.
- `v2/docs/v1-behaviors.md` — additive v2 daemon pipeline resume behavior.
