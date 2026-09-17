# Run re-admission stamps its owner

## Problem

`runs.owner_identity` is written only at run insert in `v2/src/persistence/state-store.ts`; the four `setRunStatus(context.runId, "in-progress")` re-admission calls in `v2/src/execution/workflow-runner-resume.ts` (`runIntentResumeCommitAndPublish`, `runMutationRepairAttempt`, `runReviewMutationCommitAndPublish`, `replayMutationFinalization`) leave the prior generation's identity on the row. Pipelines already re-claim via `claimPipelineContinuation`/`adoptOrphanedPipeline`.

## Decisions

- New store method `admitRunForResume(runId): Promise<RunAdmissionOutcome>` performs the stamp; `setRunStatus` itself is unchanged. Rules out widening blast radius across `setRunStatus`'s ~18 call sites, only 4 of which are resume re-admission.
- `RunAdmissionOutcome` is a new run-scoped type (`{ kind: "applied" } | { kind: "refused"; reason: "owner_alive" | "claim_lost" }`), not a reuse of `PipelineContinuationOutcome`, which carries `pipelineId`. Rules out a mismatched shape leaking pipeline fields onto runs.
- `admitRunForResume` follows the existing `adoptOrphanedPipeline`/`claimPipelineContinuation` split: it reads the row's current `owner_identity` first; if it is non-null, not the current identity, and alive per `isOwnerAliveProbe` (async), it refuses `"owner_alive"` before any write. Rules out running the async liveness probe inside a synchronous transaction, which the intent's "same transaction" wording would otherwise require.
- Otherwise it issues a single guarded `UPDATE runs SET owner_identity = ?, status = 'in-progress', finished_at = NULL, status_changed_at = ? WHERE id = ? AND owner_identity IS <observed-prior-value>`; zero rows changed (owner moved between the probe and the write) refuses `"claim_lost"`. Rules out an unconditional overwrite racing a concurrent claim.
- `owner_identity IS NULL` or `= currentIdentity` admits without the liveness probe, matching pipeline adoption semantics.
- The four `workflow-runner-resume.ts` call sites above switch to `await store.admitRunForResume(context.runId)`; on `refused`, the function throws a new `RunAdmissionRefusedError(runId, reason)` (exported next to `RunAdmissionOutcome` in `state-store.ts`) before invoking the completion committer or writing any other run state. Rules out silently continuing to commit/publish under a stale identity, and resolves the conflict between "callers must not proceed" and deferring caller behavior — these are existing production callers, not a future first consumer.
- `daemon.ts:664`'s queued→in-progress promotion is excluded from `admitRunForResume`: a queued run has not executed under any owner yet, so its insert-time stamp is still the only admission that has occurred; routing it through the liveness-gated path risks refusing a queued run whose creating (short-lived CLI) identity already reads as dead, even though no execution happened under it.
- `recoverReconciledRuns` (`daemon.ts`) reaches these same four call sites through its `resume` RPC dispatch, so recovery is covered without a separate code path.

## Acceptance criteria

- [ ] A test in `v2/src/persistence/state-store.test.ts` asserts `admitRunForResume` stamps the calling identity (and sets status `in-progress`) when the run's prior owner is null, is the current identity, or is dead; it fails against the insert-only stamp.
- [ ] A test in `v2/src/persistence/state-store.test.ts` asserts `admitRunForResume` refuses with `reason: "owner_alive"` when a different live owner holds the row, leaving `owner_identity` and status unchanged.
- [ ] A test covering one of the four `workflow-runner-resume.ts` resume paths (e.g. `runIntentResumeCommitAndPublish`) asserts that when `admitRunForResume` refuses, the completion committer is never invoked and no further run state is written; it fails against the pre-fix unconditional `setRunStatus` call.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Daemon retirement on supersession — resume/recovery re-stamps the admitting daemon via `admitRunForResume`; a live different owner refuses and the resume attempt aborts before commit/publish; the daemon's queued→in-progress promotion is unaffected.
- `v2/docs/v1-behaviors.md` — record the new baseline replacing the insert-only run ownership stamp.
