# Settle daemon-owned pipelines from terminal publication

## Problem

`runPipeline` stops when every authored stage is satisfied and `derivePipelineState` reads `succeeded`. The admitted `terminalAction` is never applied and terminal publication failures are neither executed nor recorded.

## Prerequisites

- `executeTerminalPublication` and its contract are merged under `v2/spec/completed/` (`v2/spec/20260730T154836Z-execute-pipeline-terminal-publication/` until moved) — settle implementation does not start until that executor spec lands on `main`.
- Project-pipeline resolution copies a validated `terminalAction` onto admitted definitions (`v2/spec/completed/20260730T091934Z-configure-and-validate-pipeline-terminal-action/`).
- Daemon approval and stage-scoped resume (`v2/spec/completed/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/`).

## Decisions

- After the ordered stage walk completes with every authored stage satisfied, `runPipeline` invokes `executeTerminalPublication` when `definition.terminalAction` is set; omitting it preserves pre-settle stage-only success — rules out forcing terminal publication on definitions without a configured action.
- Terminal publication runs only after the stage walk finishes with no `stop` outcome and every workflow stage `succeeded` and every approval stage `approved` — rules out early or approval-bypassing finalization.
- When `terminalAction` is set and every authored stage is satisfied but settlement has not succeeded durably, `derivePipelineState` returns `running` (checked after stage-row `failed`/`rejected`/`running`/`awaiting-approval`/`pending` predicates and before `succeeded`) — rules out `pipeline_wait` or mid-run observers reporting `succeeded` before terminal publication finishes.
- `derivePipelineState` returns `failed` when `hasPipelineTerminalPublicationFailure(pipeline)` is true (durable `terminalPublicationFailure` on the pipeline row), checked after the settling `running` predicate and before `succeeded` — rules out reporting completion while stage rows read all-succeeded yet finalization failed. Export `hasPipelineTerminalPublicationFailure` and an invert hook for AC2.
- Pipeline success requires terminal publication success when `terminalAction` is set — rules out `succeeded` over a failed ready flip or merge. On success, persist a durable success marker (`terminal_publication_succeeded_at` or equivalent) so post-crash derived state can read `succeeded` without re-deriving `running`.
- Terminal publication failure is stored on the `pipelines` row as nullable `terminal_publication_failure` JSON (`terminalAction`, normalized `PublicationFailure`, optional `prNumber`/`prUrl`); stage rows stay `succeeded` — rules out rewriting the implement stage `failed` or log-only failure.
- Terminal publication failure settles derived `failed` and is non-resumable in this slice (`resumePipeline` / `reopenFailedPipeline` do not retry settlement); retry/reopen semantics for this failure class remain deferred to the first consumer — rules out treating `no_failed_stage` refusal as an accidental bug.
- Terminal publication input resolves from the authored-order last succeeded workflow stage: `prNumber`, `prUrl`, and `specPath` from that stage's durable `artifact` (`PipelineStageArtifact`); `worktreePath` and `branch` from `store.loadRun(artifact.entryRunId)`; `baseRef` from that entry run's `specRef`; `terminalAction` from `definition.terminalAction` — rules out rediscovering a different PR or worktree from mutable branch state. When `terminalAction` is set the implement stage is the expected source.
- `continuePipeline` and `recoverContinuablePipelines` idempotently finish pending terminal publication when all stages are satisfied, `terminalAction` is set, no `terminalPublicationFailure` is recorded, and the success marker is absent — rules out crash/restart permanently skipping never-attempted settlement.
- When `terminalAction` is `leave-draft`, workflow completion publication skips ready finalization (`runReadyFinalizer`) so only terminal publication applies the leave-draft boundary per the executor composition rule — rules out a green pipeline unit test while production still flips draft during completion.
- `PipelineExecutionDeps` carries an injectable `executeTerminalPublication` seam defaulting to production `executeTerminalPublication` — rules out live `gh` in `pipeline-execution.test.ts`.
- `TerminalPublicationError` and any other throw from the settle boundary normalize to durable `terminal_publication_failure` via `normalizePublicationFailure`; stage rows are not rewritten to `failed` — rules out stranded stage failure for executor throws.
- Missing or null admission `context` at the settle boundary records durable `terminal_publication_failure` with a normalized refusal reason and leaves stage rows `succeeded` — rules out silent skip on pre-migration rows.
- Deferred to first consumer: retry and resume semantics after terminal-action failure — pin when pipeline resume consumes this failure class.

## Task checklist

- Add `terminal_publication_failure` and success-marker columns, `Pipeline.terminalPublicationFailure` type, migration, and atomic `commitTerminalPublicationFailure` / success commit on `StateStore`.
- Extend `derivePipelineState` for settling `running`, `hasPipelineTerminalPublicationFailure`, and the pre-`succeeded` failure predicate; export the failure guard and invert hook for AC2.
- After the stage loop in `runPipeline`, resolve terminal publication input per the field-source decision, call the seam, persist failure or success marker, and return without mutating succeeded stage rows.
- Extend `continuePipeline` / `isPipelineContinuable` (or equivalent) so restart finishes pending terminal publication per the recovery decision.
- Skip ready finalization in completion publication when the admitted pipeline `terminalAction` is `leave-draft`.
- Extend `pipeline-execution.test.ts` with fake terminal publication covering leave-draft, ready, and merge success, terminal mutation failure retention, merge-with-red-gate suppression (zero merge via fake seam only), stage-walk negative path, and crash-recovery continuation; wire AC2 to `hasPipelineTerminalPublicationFailure` inversion.
- Update `daemon-host.md`, `workflow-runner.md`, `state-store.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `settles each configured terminal action end to end` fails against the baseline, then drives leave-draft, ready, and merge pipelines once each against fake terminal publication, asserts the resolved executor input matches the last-succeeded-workflow-stage rule, observes derived `running` while stages are satisfied but settlement is incomplete, and observes `succeeded` only after the matching action succeeds.
- [ ] `pipeline-execution.test.ts` — `continues pending terminal publication after restart` fails against the baseline, then simulates all stages succeeded with no success marker, reruns `continuePipeline`, and observes idempotent settlement completion without re-dispatching workflow stages.
- [ ] `pipeline-execution.test.ts` — `does not invoke terminal publication when the stage walk stops early` fails against the baseline, then stops on failed workflow stage, awaiting approval, and rejected approval and confirms zero terminal-publication seam calls each time.
- [ ] `pipeline-execution.test.ts` — `fails a pipeline when its terminal action fails` fails against the baseline, then retains `terminalAction`, normalized failure, and PR evidence on the pipeline row, keeps every stage row `succeeded`, leaves derived state `failed`, and turns RED when `hasPipelineTerminalPublicationFailure` is inverted.
- [ ] `pipeline-execution.test.ts` — `does not merge a pipeline after a red ready gate` fails against the baseline, then records terminal publication failure with zero merge calls on the fake seam and derived state `failed` while stage rows remain `succeeded`; red-gate guard inversion stays in `terminal-publication.test.ts` (executor-owned).

## Documentation updates

- `v2/docs/daemon-host.md` — terminal-action invocation after the stage walk, settling `running` semantics, `terminal_publication_failure` persistence, derived-state precedence, and restart recovery for pending settlement.
- `v2/docs/workflow-runner.md` — terminal action after final workflow publication and required approval; leave-draft completion skip; settle handoff wired in production.
- `v2/docs/state-store.md` — `terminal_publication_failure` and success-marker columns on `pipelines`.
- `v2/docs/v1-behaviors.md` — v2 daemon pipeline terminal-action settlement and non-resumable terminal failure.
