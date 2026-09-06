# 02 - Resume projection honesty

## Problem

`isResumeAdmitted` derives from `composeRunOperatorError` alone, while `resumeHandler` admits through a longer resolver chain (intent finalization, review-mutation / ordinary-write finalization tails, paused linked reconstruction, then write-loop respawn). Rows can therefore project `resumable: true` / `nextAction: "resume"` — including stale terminal logs still carrying `resumable: true` — even when every resume verb refuses; the review-mutation stale-sibling case is partially pinned but paused linked rows and other refusal shapes remain reachable on main.

## Decisions

- Extract one shared `resolveRunResumeAdmission(run, terminalRecord, logRecords)` used by `resumeHandler`, `resumeContextForRun`, and `isResumeAdmitted`; rules out list/wait/resume deriving resumability from different predicates (same honesty mechanism as [[terminal-state-honesty-invariant]]).
- Projection demotes stale terminal `loop_finished.resumable: true` when the shared admission resolver refuses, surfacing `unsupported_resume_context` / `nextAction: "stop"` even if the historical log record still claims retryability; rules out advertising `resume` on rows every verb refuses.
- Paused linked rows admitted by subspec `00` project `resumable: true` / `nextAction: "resume"`; paused linked rows the resolver refuses project the same unsupported shape as other non-admitted rows; rules out optimistic pause status masking reconstruction failure.
- `composeRunOperatorError` remains the source for failure reason text and diagnostics; only the resumability bit and `nextAction` gate move behind the shared admission resolver; rules out duplicating operator-error reason mapping.

## Prerequisites

- Subspec `00` lands paused linked-row reconstruction intake.
- Subspec `01` lands owning write-row `completion_commit_failed` finalization admission.

## Task checklist

- [ ] Implement `resolveRunResumeAdmission` (name may vary) in `daemon-run-lifecycle-handlers.ts` or an adjacent daemon resume module, folding the existing handler ordering into one predicate that returns `{ admitted, refusal? }` or equivalent.
- [ ] Wire `isResumeAdmitted`, `resumeContextForRun`/`resultFrom`, and `resumeHandler` through the shared resolver.
- [ ] Extend `daemon-resume.test.ts` with a row shape the handler refuses but a stale `loop_finished.resumable: true` record still projects retryability on the pre-fix base; assert `list`, `wait`, and `resume` agree on non-admission.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` proves rows resume admission refuses do not advertise `nextAction: "resume"`; it fails while stale `resumable: true` records still project resume.
- [ ] `v2/docs/v1-behaviors.md` records that daemon `list`/`wait` `resumable` and `nextAction: "resume"` derive from the same admission resolver as `run resume`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — resume projection honesty aligned with admission.
