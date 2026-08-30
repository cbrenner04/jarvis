# Workflow-runner terminal settlement

Authoritative for workflow-runner terminal settlement: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`workflow-runner.ts` still hand-orders terminal status, publication evidence, completion boundaries, and failure detail across completion publication, pre-publication landing failures, shrink/review settle tails, and resume-driven republication. Successful workflow publication calls `setPrEvidence` then `setRunStatus(..., "completed")` separately (`workflow-runner.ts` ~1229–1231). Publication failure tails call bare `setRunStatus` for `completed` or `failed` without atomic cause or detail (`workflow-runner.ts` ~1185, ~1237). Resume and reviewed-landing paths that call `commitCompletionBoundary` with terminal `runStatus` do not commit matching `terminalCause` or evidence on the run row. Pipeline and `list`/`wait` rollup observers can therefore read a terminal workflow step row before PR evidence or failure detail is durable.

## Decision ledger

- Workflow-owned terminal transitions use the same `commitTerminalRunSettlement` / extended `commitCompletionBoundary` contract as the write loop; rules out a workflow-specific hand-ordering exception.
- Pre-publication landing failures that already persist `failed` on the step run settle with `terminalCause: "landing_failed"` (or the path’s durable `loopOutcomeKind`) and resumable failure detail in the same commit; rules out relying on a later resume tail to backfill cause.
- Completion-publication success persists confirmed PR evidence in the settlement call that first exposes `completed`; flip failures that keep `completed` supply `terminalCause: "ready_flip_failed"` and flip diagnostics atomically; rules out `setRunStatus` after an in-progress finalization tail without settlement fields.
- Resumable publication failures (`completion_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, gate out-of-scope) settle `failed` with matching cause and detail; `ready_flip_failed` remains terminal `completed` with non-resumable cause per existing semantics; rules out splitting status and cause across boundary and tail writes.
- Shrink and review settle tails that append corrective `loop_finished` rows still commit the durable run row through settlement before those appends; rules out log-first settlement.
- Workflow resume re-dispatch that reuses an existing terminal row for idempotent step skip does not rewrite settlement evidence; rules out clobbering prior atomic commits on idempotent return.

## Prerequisites

- [00 - Write-loop terminal settlement](./00-write-loop-terminal-settlement.md) merged — `commitCompletionBoundary` terminal delegation and write-loop settlement helpers are available.

## Tasks

- Inventory every production terminal transition in `workflow-runner.ts` (inline completion publication, `publishWithReadyRepair` failure and success tails, pre-publication landing failure, shrink/review settle helpers, resume republication, and workflow-level `commitCompletionBoundary` terminals) and route each through settlement with status, `terminalCause`, and available evidence.
- Remove standalone terminal `setRunStatus` and pre-terminal `setPrEvidence` calls on migrated paths.
- Add or extend workflow regressions for completed observer ordering and failure cause/detail on resume and publication tails.
- Update the durable docs listed below.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-publication.test.ts` test `workflow completion publication settles PR evidence and terminal cause atomically` drives a successful two-step workflow through completion publication, reloads the step run row before reading logs, and proves `status: "completed"`, both PR fields, and `terminalCause: "complete"` are present together; it fails against the pre-fix `setPrEvidence` / `setRunStatus` ordering reachable in `workflow-runner.ts` ~1229–1231.
- [ ] `v2/src/execution/workflow-runner-publication.test.ts` test `ready_flip_failed keeps completed with atomic non-resumable cause` drives a flip failure through the publication tail, reloads the row before logs, and proves `status: "completed"`, `terminalCause: "ready_flip_failed"`, and `terminalFailureDetail` are durable together; it fails against the pre-fix `setRunStatus` tail reachable in `workflow-runner.ts` ~1185.
- [ ] `v2/src/execution/workflow-runner-plan.test.ts` test `pre-publication landing failure settles failed with landing cause before loop_finished` drives a landing collision to `pre-publication`, reloads the row before logs, and proves `status: "failed"`, `terminalCause: "landing_failed"`, and resumable failure detail; it fails against the pre-fix boundary/status path that omits atomic run-row cause.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` test `review-mutation resume republication settles completed with PR evidence atomically` resumes a `completion_commit_failed` workflow row through republication, reloads before logs, and proves `status: "completed"` with PR pair and `terminalCause: "complete"` on the first durable observation; it fails against the pre-fix resume publication tail that writes status without settlement.
- [ ] `v2/src/execution/workflow-runner-publication.test.ts` — `workflow completion publication settles PR evidence and terminal cause atomically`; Mutation checkpoint: `// @mutate v2/src/execution/workflow-runner.ts` restoring standalone `setPrEvidence` before terminal `setRunStatus` on the success tail turns the test RED.
- [ ] `workflow-runner-resume.test.ts` tests `a settled review-mutation resume failure emits a loop_finished whose resumable field agrees with this resolver's own admission` and `workflow-runner-publication.test.ts` test `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary` stay green (preserved resumability and surviving-mutation semantics).
- [ ] `v2/docs/workflow-runner.md` documents workflow settlement routing through atomic terminal commits for publication, pre-publication, shrink/review settle, and resume tails.
- [ ] `v2/docs/v1-behaviors.md` records the workflow-runner terminal-settlement behavior change.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — workflow-owned terminal transitions, settlement routing, immediate observer contract, and preserved resume/idempotence rules.
- `v2/docs/write-behavior.md` — cross-link workflow publication and resume tails to the shared atomic settlement contract when this slice touches shared completion semantics.
- `v2/docs/v1-behaviors.md` — record workflow-runner atomic terminal settlement.
