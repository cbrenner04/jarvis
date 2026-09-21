# 01 — Resume admission reopens the failed stage

## Problem

Settlement only matches `running` stages, so a `failed` stage stays `failed` after its linked write row is resumed. The failure also skipped the stage's suffix and failed the pipeline.

## Decisions

- Eligibility is one predicate: a run-resume admission that applies (`StateStore.admitRunForResume`, after `resolveRunResumeAdmission` admits) on a row of the invocation whose entry run a `failed` stage links. Rules out `failureDetail.nextAction === "resume"` recorded at settlement and the cause kind: neither matches what `run resume` admits (finalization-tail rows such as `surviving_mutation_failed` admit without that detail).
- Non-resumable rows never reach admission, so their stages are never reopened; no separate non-resumable check.
- The stage goes back to `running` (compare-and-set on `failed` and on `workflowInvocationId` still equal to the entry run), not settled directly from `failed`. Every `running`-only settlement path — terminal event, post-wait adoption, daemon-start sweep — then works unchanged, and `pipeline list`/TUI show `running` during the resume.
- Reopening clears the stage's `failureDetail` and `endedAt`, returns the suffix the failure skipped to `pending` (shape analysis shared with `reopenFailedPipeline`), and moves the pipeline from `failed` back to in-progress. `reopenFailedPipeline` itself is not reused: it resets the stage to `pending` and drops the link.
- A dismissed pipeline, or a stage `pipeline resume`/`recover` already relinked (its `workflowInvocationId` no longer the entry run) or reopened, is not reopened; the compare-and-set is the guard.
- A failed resume (admission rolled back via `restoreRunAfterFailedResume`) restores the stage to its pre-admission `failed` state.

## Acceptance criteria

- [x] A test resumes a `surviving_mutation_failed` write row linked by a `failed` stage: the stage is `running` with cleared failure detail, its skipped suffix `pending`, and the pipeline in-progress. It fails against the pre-fix code, which leaves all three untouched.
- [x] A test resumes a row whose stage was relinked by `pipeline resume` (or whose pipeline is dismissed): the stage is not reopened.
- [x] A test shows a failed resume rollback leaves the stage `failed` with its original failure detail.
- [x] A test shows a `failed` stage linked to a non-resumable row (`nextAction: "stop"`) that a direct store write later marks `completed` stays `failed` with no `run resume` admission. It fails against a reopen keyed on row status rather than admission.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — the observable behavior change is documented in subspec 02.
