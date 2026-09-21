# 00 — Resumed rows settle by their invocation's entry run

## Problem

A stage links the invocation's entry run (`workflowInvocationId`). Two `run resume` paths never settle a stage linked to it, so even a `running` stage stays wedged after the resumed row goes terminal:

- Linked path (`resumeLinkedWorkflowStart` → `startWorkflowRun`, `v2/src/daemon/daemon-workflow-admission-handlers.ts`): its terminal `settleStagesForEntryRun` call keys on the first step-0 row the resumed `executeWorkflow` reports — the resumed `<step>~link-N` row — not the entry run the stage links.
- Bare path (`resumeReconstructedRun` → `spawnWriteLoop`, `v2/src/daemon/daemon-run-lifecycle-handlers.ts`): the write-loop `finally` calls no settlement.

## Decisions

- The resumed row resolves to its entry run through its `workflowSnapshot`: the invocation's row whose `stepId` is `snapshot.steps[0].stepId` (the lookup `rewriteSettledMarkerAfterFailedRepublication` already uses) — not a relink of the stage to the `~link-N` row.
- Both resume paths call the existing `settleStagesForEntryRun` on that entry run at terminal; no new settlement entry point.
- A resumed row with no `workflowSnapshot` is its own entry run.

## Acceptance criteria

- [ ] A test resumes a `~link-N` row of an invocation whose entry run a `running` stage links; when the resumed workflow reaches terminal, the stage settles from the invocation's rows. It fails against the pre-fix code, which settles nothing.
- [ ] A test bare-resumes a write row a `running` stage links; when the write loop ends, the stage settles from its durable row. It fails against the pre-fix code, which never settles it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — the observable behavior change is documented in subspec 02.
