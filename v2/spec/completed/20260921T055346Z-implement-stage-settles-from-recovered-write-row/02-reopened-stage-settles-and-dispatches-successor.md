# 02 — Reopened stage settles and dispatches its successor

## Problem

Once a resumed stage is `running` again (subspec 01) and settles (subspec 00), nothing continues the pipeline: no executor is live for a pipeline that had failed, so the successor never dispatches (pipeline `a9b661d5`, PR #4013).

## Decisions

- Settlement itself is unchanged (`settleLinkedStagesFromEntryRunWith`, `requiredStatus: "running"`); the failing test drives `settleStagesForEntryRun` (or the daemon-start sweep), not the inner helper.
- A stage settling `succeeded` from a resumed row continues its pipeline through the existing `continuePipeline`, which dispatches the pending successor; no new dispatch hook.
- Successor dispatches once: only the settle call that transitions the stage `running` → `succeeded` continues the pipeline (a repeat settle returns `no-linked-stages`), and `continuePipeline`'s existing owner/admission claim refuses a concurrent continuation.
- A resumed row that settles failed leaves the stage `failed` with failure detail from the new settlement, and re-skips the suffix.
- The PR artifact comes from the existing `resolvePrEvidenceAcrossInvocation`, so publication on a sibling row after the resume is honored.

## Acceptance criteria

- [x] A test proves a stage whose write row settled `surviving_mutation_failed`, then was resumed and settled `completed`, settles `succeeded` with the PR artifact and dispatches its successor exactly once, driven through `settleStagesForEntryRun`; it fails against the pre-fix code, which leaves the stage `failed`.
- [x] A test shows a resumed row that settles failed leaves the stage `failed` with failure detail from the new settlement and its suffix skipped, and dispatches nothing. It fails against a settlement that keeps the stale pre-resume failure detail.
- [x] A test shows a second settlement of the same entry run does not dispatch the successor again.
- [x] `v2/src/persistence/pipeline-stage-settlement.test.ts` stays green (non-resumable failed rows settle as before).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `run resume` on a stage's resumable write row advances the pipeline.
- `v2/docs/v1-behaviors.md` — record the changed stage-settlement behavior: a resumed write row reopens and settles its failed stage, and a success continues the pipeline.
