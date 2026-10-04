# 00 - Daemon linked paused row resume intake

## Problem

`reconstructWriteResume` in `daemon-run-lifecycle-handlers.ts` matches only exact snapshot step ids or a daemon-local `~shrink` suffix slice, so operator `jarvis run resume` on a paused `implement~link-N` row returns `resume_unsupported` even though `reconstructPausedWriteResumeInput` in the execution loop already reconstructs linked routing context (#3463).

## Decisions

- `reconstructWriteResume` resolves authored snapshot steps through `shared/write-sibling-step-id.ts` (`findSnapshotStepForRunStepId`); rules out daemon-only `endsWith("~shrink")` / exact-id matching while the runner mints `~link-N`.
- Paused rows whose persisted `stepId` matches `<authoredStepId>~link-N` delegate write-loop reconstruction to exported `reconstructPausedWriteResumeInput`; rules out reimplementing linked-index routing inside the daemon.
- Authored-step paused rows (exact id or `~shrink`) keep the existing reprompt-aware reconstruction path after shared base-step lookup replaces the shrink suffix slice; rules out regressing hidden-shrink paused resume.
- Deferred to first consumer: whether non-paused failed `implement~link-N` write-loop replay belongs in this intake — pin when an operator path needs it beyond paused admission.

## Prerequisites

- `shared/write-sibling-step-id.ts` and execution-loop adoption landed in `20260905T234404Z-write-sibling-step-id-matcher`.
- `reconstructPausedWriteResumeInput` and its execution-loop regressions landed in the same spec's `03-linked-row-paused-resume-reconstruction.md`.

## Task checklist

- [ ] Replace daemon-local snapshot step lookup in `reconstructWriteResume` with `findSnapshotStepForRunStepId`; preserve shrink role binding via the shared authored step, not `stepId.slice`.
- [ ] When `run.status === "paused"` and `matchesLinkedSiblingStepId(stepId, authoredStepId)`, call `reconstructPausedWriteResumeInput`, map its `WriteLoopInput` through `resolveWriteLoopBindings`, and return that result instead of the authored-step literal.
- [ ] Thread landing, staged-Markdown, and surviving-mutation reprompt fields on authored-step paused reconstruction exactly as today.
- [ ] Add a `daemon-resume.test.ts` end-to-end fixture: paused `implement~link-N` with linked index materialization, assert `run resume` spawns the write loop with `specReadRoot` / active subspec `expectedArtifactPath` and records `iteration_started`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-resume.test.ts` proves `run resume` on a paused `implement~link-N` row re-enters the linked loop and dispatches the next subspec; it fails against the current `resume_unsupported` refusal (#3463).
- [x] `v2/src/daemon/daemon-run-lifecycle-handlers.test.ts` `resume maps hidden ~shrink stepId to shrink role via snapshot base step` stays green.
- [x] `v2/docs/operator-runbook.md` documents `jarvis run resume` on paused linked implement rows (`implement~link-N`) and narrows [Clearing a stale non-active run with `run kill --force`](#clearing-a-stale-non-active-run-with-run-kill---force) so force-kill is not the recovery path when linked paused resume succeeds.
- [x] `v2/docs/v1-behaviors.md` records daemon admission of paused `<stepId>~link-N` resume through `reconstructPausedWriteResumeInput`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — linked paused-row resume; retire force-kill as the primary workaround for reconstructable paused linked rows.
- `v2/docs/v1-behaviors.md` — daemon linked paused-row resume admission.
