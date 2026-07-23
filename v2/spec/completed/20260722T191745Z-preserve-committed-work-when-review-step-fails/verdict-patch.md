## Verdict — changes required

**1. Fix the wrong error reason in `v2/docs/workflow-runner.md:549`.**
The stall sentence names `error.reason: "role_idle_stall"`, which no code emits — the real reason is `role_stalled` (`v2/src/daemon/run-operator-error.ts`). This change rewrote that sentence and carried the error forward. Docs must name the reason the daemon actually returns.

**2. Make the preservation test actually prove preservation.**
The new timeout test asserts only that the verdict file exists and is non-empty. That cannot distinguish the adjudicated verdict from the empty placeholder the review cycle writes before roles run, so it does not satisfy AC1 ("the adjudicated verdict file still holds the adjudicator's output"). Required: assert the verdict file's content equals the adjudicator's output, and assert the recorded failure attribution names the actuator role (not merely that *some* role timed out) — the latter also removes any ambiguity from the 5 ms bound about which role lost the race.

**3. Assert the write step is not re-run on re-dispatch.**
AC3 says re-dispatch "re-invokes no write-step agent," but the re-dispatch test counts only actuator invocations, and `firstActuatorCount` (line 3564) is assigned and never read. Required: the test must count implement-step agent invocations across both dispatches and assert zero on the second. Remove the dead variable.

**4. Pin the other two modified guards.**
Three sites changed `resumable` (`runReviewDebateStep`, `standardReviewRoleFailureOutcome`, `runProfileReviewStep`), but only the debate path has timeout coverage. AC6 requires every modified guard pinned in both directions. Required: at least one timeout case and one non-timeout case exercising the profile-review / standard-role-failure path.

**5. Correct the recovery instructions in the docs.**
`v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` now say a timed-out review is "resumable," which will read as `jarvis run resume` — but the daemon rejects resume on a `failed` run that isn't publication-retry-eligible, so that command hard-errors. The spec's decided recovery is re-dispatching the same workflow. Required:
- State the concrete recovery path (re-dispatch the workflow) and that `run resume` is not it.
- Scope the "the completed implement write step's checkpoint survives" claim to implement workflows; the guard keys on `failureKind` alone, so intent/plan review timeouts also become retryable with no write checkpoint behind them. The unconditional claim is false for those.
- Note that re-dispatch sweeps any partial edits the aborted actuator left into the next completion commit, so the operator should inspect the worktree first. This hazard is newly reachable precisely because re-dispatch is now the advised path.

**6. Tidy the inconsistent timeout derivation** in `runReviewDebateStep`: `kind` is derived from the last cycle while `resumable` is derived from the same object via a separately-computed predicate elsewhere in the file. Not a live bug — `timeout` only originates from a `role_failed` outcome today — but the two review paths should determine "is this a timeout" the same way so a future divergence doesn't silently split them.

**Not upheld:** the new non-timeout `resumable: false` case is not redundant with the existing review-failure sequencing test — it pins the changed guard's negative direction, which AC6 requires. Keep it. The `resumable: true` flag itself is required by AC2 and stays; the tension with the resume path is resolved in docs (item 5), not code.