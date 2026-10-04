# Linked-row paused resume reconstruction

## Problem

`reconstructWriteResume` in `daemon-run-lifecycle-handlers.ts` refuses paused `implement~link-N` rows (`resume_unsupported: run has no matching workflow snapshot step`) because it matches only exact snapshot step ids or the `~shrink` suffix. The execution loop already mints linked rows and routes active subspecs during forward execution, but no execution-loop helper reconstructs write-loop input for a paused linked row with `specReadRoot` and the active subspec threaded through.

## Decisions

- Export an execution-loop `reconstructPausedWriteResumeInput` (name may vary) from `workflow-runner-resume.ts` that uses the shared matcher to resolve the authored write step, re-reads linked-index routing for the paused `~link-N` row, and returns `WriteLoopInput` with `resumeReentry: true`, `specReadRoot`, and `expectedArtifactPath` for the active subspec; rules out treating a linked row as a one-off snapshot step with no routing context.
- Deferred to first consumer: daemon `reconstructWriteResume` calling the execution helper — pin when `dedupe-daemon-cruft` or the linked-run-rows daemon intake lands; this subspec proves the helper and execution-loop wiring only; operator `jarvis run resume` on `implement~link-N` remains unsupported until that consumer lands.
- External-plan runs use persisted `specReadRoot` on the snapshot write step with absolute `expectedArtifactPath` for the active linked subspec; in-repo linked runs keep worktree-relative artifact paths without `specReadRoot`; rules out re-deriving the external root from `dirname(specPath)` on resume.

## Tasks

- [x] Implement `reconstructPausedWriteResumeInput` in `workflow-runner-resume.ts` (or adjacent execution resume module) using `shared/write-sibling-step-id.ts` plus existing linked-subspec routing helpers.
- [x] Add a `workflow-runner-resume.test.ts` regression for a paused `implement~link-N` row with an external linked index: assert the reconstructed input carries `specReadRoot`, the active subspec `expectedArtifactPath`, and `resumeReentry: true`; it fails against the pre-fix absence of the helper (or against a stub that only matches exact snapshot step ids).
- [x] Add a `workflow-runner-resume.test.ts` regression for a paused in-repo `implement~link-N` row: assert the reconstructed input carries worktree-relative `expectedArtifactPath` for the active linked subspec, omits `specReadRoot`, and sets `resumeReentry: true`; it fails against the pre-fix absence of the helper.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-resume.test.ts` proves paused external `implement~link-N` resume reconstruction threads `specReadRoot` and the active linked subspec into write-loop input; it fails against the pre-fix code that cannot resolve `implement~link-N` to an authored write step plus linked routing context.
- [x] `v2/src/execution/workflow-runner-resume.test.ts` proves paused in-repo `implement~link-N` resume reconstruction threads worktree-relative `expectedArtifactPath` without `specReadRoot`; it fails against the pre-fix absence of the helper.
- [x] `v2/docs/workflow-runner.md` documents write-sibling step-id grammar (`<stepId>`, `<stepId>~link-N`, `<stepId>~shrink`) and the single matcher contract in `shared/write-sibling-step-id.ts`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — linked-row step-id grammar and single matcher contract.
