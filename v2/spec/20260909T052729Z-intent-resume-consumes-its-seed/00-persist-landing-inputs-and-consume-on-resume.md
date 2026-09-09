# 00 - Persist landing inputs on the snapshot and consume them on resume

## Problem

The first-pass landing (`landReviewedPublicationOutput` in `publication-landing.ts`) consumes `landing.inputs` — the seed's `{ sourceRoot, paths, consumeFrom }` — when present. `buildWorkflowSnapshot` (`workflow-runner.ts`) never records those inputs on the write step, and `resolveIntentFinalizationResumeContext` (`workflow-runner-resume.ts`) rebuilds `landing: { kind: "intent-stage", output, stagingDir, invocationId, baseRef }` with no `inputs`, so the same landing function on resume has nothing to consume. Run `f85ed0fc` (2026-09-03) published PR #3407 with its seed still on disk.

## Decisions

- `WorkflowSnapshotStep` gains optional `landingInputs: { sourceRoot, paths, consumeFrom }`, written by `buildWorkflowSnapshot` from the write step's `landing.inputs`; rules out recomputing consumption from CLI state resume does not have.
- `resolveIntentFinalizationResumeContext` threads `landingInputs` into the rebuilt landing as `inputs`, so `landReviewedPublicationOutput` consumes exactly what the first pass would have; rules out consumption living only on the non-resume path.
- An intent-stage resume whose persisted write step recorded no `landingInputs` refuses admission with a named reason (`landing inputs not recorded on the persisted snapshot; re-run the intent`) instead of publishing a half-consumed queue; legacy snapshots from before this change fall under that refusal by design; rules out best-effort silent skip.
- The ordinary first-pass landing is untouched.

## Tasks

- Extend `WorkflowSnapshotStep`, `buildWorkflowSnapshot`, and the resume context resolver.
- Tests in `workflow-runner-resume.test.ts` (resume consumes; refusal without recorded inputs) and `workflow-runner-publication.test.ts` or the existing landing test (first pass still consumes).

## Acceptance criteria

- [ ] `workflow-runner-resume.test.ts` test `intent resume consumes the seed recorded in the persisted landing inputs` seeds a failed intent review row whose snapshot write step carries `landingInputs` naming a seed file, resumes it, and asserts the seed is gone after landing; it fails against the current inputs-less rebuild.
- [ ] `workflow-runner-resume.test.ts` test `intent resume without recorded landing inputs refuses instead of publishing` proves a snapshot lacking `landingInputs` settles a named refusal and publishes nothing; it fails against the current best-effort landing.
- [ ] An existing or new landing test proves the first-pass intent landing still consumes `landing.inputs`.
- [ ] `workflow-runner.test.ts` or `workflow-runner-core.test.ts` proves `buildWorkflowSnapshot` records `landingInputs` from a write step's `landing.inputs`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Intent finalization failed with staged files remaining: resume consumes the seed; no manual deletion before merging.
- `v2/docs/workflow-runner.md` — publication landing contract: seed consumption is part of finalization on both first-pass and resume paths, driven by persisted `landingInputs`.
- `v2/docs/state-store.md` — `workflow_snapshot` step field `landingInputs`.
