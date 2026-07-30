# Stage-scoped pipeline resume

## Problem

- Failed and awaiting pipelines stop at durable boundaries, but no daemon-owned operation re-enters the eligible stage without restarting the pipeline or silently succeeding on terminal work.

## Prerequisites

- `reopenFailedPipeline` atomically reopens a valid failed-plus-skipped-suffix shape in place (`v2/spec/20260730T043255Z-pipeline-durable-approval-and-reopen-state/06-reopen-failed-pipeline-in-place.md`).
- `continuePipeline` re-dispatches only the eligible continuation row and preserves succeeded predecessor invocation IDs and artifacts (`pipeline-execution.test.ts`).
- Daemon-owned approval decisions from [00 - Daemon-owned approval decisions](./00-pipeline-approval-decisions.md).

## Decisions

- Add `pipeline_resume { pipelineId }` as the sole daemon-owned stage-scoped resume entry point; rules out translating resume into `pipeline_start` or run-level `resume`.
- For a derived `failed` pipeline, `pipeline_resume` applies `reopenFailedPipeline` when needed, then asynchronously continues via `continuePipeline`; rules out re-dispatching completed predecessors.
- For a derived `awaiting-approval` pipeline, `pipeline_resume` re-enters the ordered loop without approving the gate and dispatches no later stage; rules out fail-open continuation past `awaiting`.
- Resume on derived `succeeded` refuses `pipeline_terminal_succeeded`; resume on derived `rejected` refuses `pipeline_terminal_rejected`; rules out silent no-op on terminal pipelines.
- Deferred to first consumer: resume eligibility for `running`, `pending`, or `interrupted` derived states — pin when an operator path needs it.
- The handler returns after reopen and/or claim admission (or refusal) and detaches like `pipeline_start`; rules out client-held continuation.
- Mutating pipeline RPC retirement follows the same `daemon_superseded` guard as `pipeline_start`.

## Task checklist

- Add daemon-owned resume entry point in `pipeline-execution.ts` composing reopen eligibility, `reopenFailedPipeline`, terminal refusal, and `continuePipeline`.
- Register `pipeline_resume` handler in `daemon.ts` with validation, async continuation, and focused handler coverage.
- Extend `v2/src/daemon/pipeline-execution.test.ts` for failed-only redispatch, awaiting preservation, distinct terminal refusals, and guard inversion.
- Document stage-scoped resume semantics and terminal refusal codes in `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [ ] A regression in `v2/src/daemon/pipeline-execution.test.ts` fails on baseline and then proves `pipeline_resume` on a failed pipeline re-dispatches only the failed continuation stage while every prior stage `workflowInvocationId` stays unchanged.
- [ ] The same regression file fails on baseline and then proves `pipeline_resume` on an `awaiting-approval` pipeline preserves `awaiting` on the gate and dispatches no later workflow stage.
- [ ] The same regression file fails on baseline and then proves resume on a completed pipeline returns `pipeline_terminal_succeeded` and on a rejected pipeline returns `pipeline_terminal_rejected`, each without stage dispatch.
- [ ] Inverting the failed-only redispatch, awaiting-no-dispatch, or terminal-refusal guard makes `v2/src/daemon/pipeline-execution.test.ts` fail; negative cases prove completed and rejected resume attempts change no stage row and dispatch nothing.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_resume` RPC contract, failed reopen composition, awaiting re-entry without approval, predecessor preservation, and named terminal refusals.
- `v2/docs/v1-behaviors.md` — additive v2 daemon pipeline resume behavior.
