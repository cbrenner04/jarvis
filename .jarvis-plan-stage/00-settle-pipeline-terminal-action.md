# Settle daemon-owned pipelines from terminal publication

## Problem

`runPipeline` stops when every authored stage is satisfied and `derivePipelineState` reads `succeeded`. The admitted `terminalAction` is never applied and terminal publication failures are neither executed nor recorded.

## Prerequisites

- `executeTerminalPublication` and its contract (`v2/spec/20260730T154836Z-execute-pipeline-terminal-publication/`).
- Project-pipeline resolution copies a validated `terminalAction` onto admitted definitions (`v2/spec/completed/20260730T091934Z-configure-and-validate-pipeline-terminal-action/`).
- Daemon approval and stage-scoped resume (`v2/spec/completed/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/`).

## Decisions

- After the ordered stage walk completes with every authored stage satisfied, `runPipeline` invokes `executeTerminalPublication` when `definition.terminalAction` is set; omitting it preserves pre-settle stage-only success — rules out forcing terminal publication on definitions without a configured action.
- Terminal publication runs only after the stage walk finishes with no `stop` outcome and every workflow stage `succeeded` and every approval stage `approved` — rules out early or approval-bypassing finalization.
- `derivePipelineState` returns `failed` when a durable `terminalPublicationFailure` is present on the pipeline row, checked after stage-row `failed`/`rejected`/`running`/`awaiting-approval`/`pending` predicates and before `succeeded` — rules out reporting completion while stage rows still read all-succeeded yet finalization failed.
- Terminal publication failure is stored on the `pipelines` row as nullable `terminal_publication_failure` JSON (`terminalAction`, normalized `PublicationFailure`, optional `prNumber`/`prUrl`); stage rows stay `succeeded` — rules out rewriting the implement stage `failed` or log-only failure.
- Pipeline success requires terminal publication success when `terminalAction` is set — rules out `succeeded` over a failed ready flip or merge.
- PR evidence comes from the last succeeded workflow stage artifact in authored position order (`prNumber`, `prUrl`, `specPath` linkage); `worktreePath`, `branch`, and `baseRef` come from persisted admission `context` and stage resolution inputs — rules out rediscovering a different PR from mutable branch state.
- `PipelineExecutionDeps` carries an injectable `executeTerminalPublication` seam defaulting to production `executeTerminalPublication` — rules out live `gh` in `pipeline-execution.test.ts`.
- Deferred to first consumer: retry and resume semantics after terminal-action failure — pin when pipeline resume consumes this failure class.

## Task checklist

- Add `terminal_publication_failure` column, `Pipeline.terminalPublicationFailure` type, migration, and `commitTerminalPublicationFailure` (or equivalent atomic write) on `StateStore`.
- Extend `derivePipelineState` for the new pre-`succeeded` failure predicate; export a testable settlement guard used by the failure AC inversion.
- After the stage loop in `runPipeline`, resolve terminal publication input from the last succeeded workflow artifact plus admission context, call the seam, persist failure on `TerminalPublicationError`, and return without mutating succeeded stage rows.
- Extend `pipeline-execution.test.ts` with fake terminal publication covering leave-draft, ready, and merge success, terminal mutation failure retention, and merge-with-red-gate suppression; add guard-inversion hooks for the settlement and red-gate guards.
- Update `daemon-host.md` ordered-progression / derived-state sections, `workflow-runner.md` settle handoff (production wiring no longer deferred), and `v1-behaviors.md` daemon pipeline terminal-action settlement.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `settles each configured terminal action end to end` fails against the baseline, then drives leave-draft, ready, and merge pipelines once each against fake terminal publication and observes derived state `succeeded` only after the matching action succeeds.
- [ ] `pipeline-execution.test.ts` — `fails a pipeline when its terminal action fails` fails against the baseline, then retains `terminalAction`, normalized failure, and PR evidence on the pipeline row, keeps every stage row `succeeded`, leaves derived state `failed`, and turns RED when its settlement guard is inverted.
- [ ] `pipeline-execution.test.ts` — `does not merge a pipeline after a red ready gate` fails against the baseline, then records terminal publication failure with zero merge calls and derived state `failed` while stage rows remain `succeeded`; inverting the gate-before-merge guard turns the test RED.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal-action invocation after the stage walk, `terminal_publication_failure` persistence, and derived-state precedence over stage-only success.
- `v2/docs/workflow-runner.md` — terminal action after final workflow publication and required approval; settle handoff wired in production.
- `v2/docs/v1-behaviors.md` — v2 daemon pipeline terminal-action settlement.
