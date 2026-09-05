---
name: linked-run-rows-resume-and-settle-uniformly
---

# Linked run rows (`~link-N`, `~shrink`) resume and settle through one matcher

## Problem

The daemon and the execution loop disagree about which run rows exist. `workflow-runner.ts` mints `~link-N` sibling rows and `workflow-runner-resume.ts` understands them (`isWriteSiblingStepId`), but `reconstructWriteResume` in `daemon-run-lifecycle-handlers.ts` matches `candidate.stepId === run.stepId` or the `~shrink` suffix only. Every resume verb the projection advertises on these rows is a lie in a different way — three intake issues, one root cause (the 2026-09-05 queue audit: "one spec, not three"):

- **#3463** — `run resume` on a paused `implement~link-0` (`missing_blocker`, `resumable: true`) refuses `resume_unsupported: run has no matching workflow snapshot step`. Pipeline resume refuses too (`branch_not_resumable`: stage `running`/`settlement_deferred` behind the paused run). Only exit: force-kill and reopen from base, discarding committed subspec work.
- **#3462** — `run resume` on a `completion_commit_failed` `implement~shrink` row prints `resumed <id>`, exits 0, and does nothing: no attempt row, no log record, no status change; the row keeps advertising `nextAction: "resume"`.
- **#3395** — `run resume` on a post-publication review row settled `surviving_mutation_failed`/`retryable: true` re-runs the mutation gate against the unchanged tree and surfaces its deterministic verdict as `internal_error` instead of redriving the agent with the surviving-mutation reprompt (or settling non-resumable).

## Decisions

- One shared step-row matcher (the `isWriteSiblingStepId` family) serves daemon resume reconstruction and execution-loop row minting; rules out the daemon special-casing `~shrink` while the runner mints `~link-N`.
- Resuming a paused `~link-N` row re-enters the linked implement loop for its invocation with `specReadRoot` and the active subspec threaded; rules out the one-line suffix match that leaves the routing loop unreachable.
- Every resume path either performs an observable replay (attempt row + `iteration_started`) or refuses with a named reason; rules out a silent `ok` that changes nothing (#3462's shape).
- `resumable`/`nextAction` projection derives from what the daemon's resume admission actually accepts — a row no verb can drive never advertises `resume`; rules out the projection and the admission disagreeing (same honesty mechanism as [[terminal-state-honesty-invariant]]).
- `surviving_mutation_failed` resume redrives the owning review agent with the reprompt before re-running the gate, or the row settles non-resumable naming hand-finish; rules out a resume that can never succeed by construction.

## Acceptance criteria

- [ ] A daemon test proves `run resume` on a paused `~link-N` row re-enters the linked loop and dispatches the next subspec; fails against the current `resume_unsupported` refusal.
- [ ] A daemon test proves `run resume` on a `completion_commit_failed` `~shrink` row records an attempt and re-runs the finalization replay, or refuses with a named reason; fails against the current silent no-op.
- [ ] A test proves `surviving_mutation_failed` resume redrives the agent (or settles non-resumable with a named action) instead of returning `internal_error` from a gate re-check.
- [ ] A projection test proves rows the resume admission refuses do not advertise `nextAction: "resume"`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — linked-row step-id grammar and the single matcher contract.
- `v2/docs/operator-runbook.md` — resume behavior on linked rows; retire the force-kill-and-reopen workaround.
