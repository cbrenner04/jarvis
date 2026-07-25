# Review checkpoint reuse is keyed like a cache, not a retry aid

## Problem

`findReviewLandingCheckpoint` (`v2/src/execution/workflow-runner.ts`) looks up a completed review
run by `(project, branch, stepId)` — nothing identifies *which dispatch* produced it. Combined with
`shouldReuseReviewCheckpoint`, which returns true for `stepId === "implement-review"` even with no
landing, a second `jarvis run workflow implement` on the same branch found the previous dispatch's
completed row and **skipped patch review entirely**, returning `complete`.

Found in operator review of PR #1859 on 2026-07-21, before merge. The spec that introduced it said
only "reuse the completed-review landing/publication checkpoint **on retry**" — correct intent, but
nothing in the key expressed "on retry", so the implementation satisfied the letter of the spec
while silently disabling review on re-runs.

The immediate fix gates reuse on `freshDispatch` (the daemon sets it on every dispatch; retries and
resumes leave it unset), matching how write steps already skip reuse at `workflow-runner.ts:1157`.
That closes the case but leaves the shape: a checkpoint keyed identically to a cache, whose
retry-only meaning lives in a caller's flag rather than in the lookup.

Note the near-miss on the obvious alternative: keying reuse on `workflowSnapshot.invocationId` does
**not** work, because `buildWorkflowSnapshot` only reuses a prior snapshot when it can find a
durable **write** step. A review-only workflow therefore mints a fresh `invocationId` on every
retry, so an invocationId-scoped guard breaks legitimate retries — verified, it fails 4 existing
tests.

## Decisions

- Make the retry scope explicit in the checkpoint's identity or lookup rather than inferred from a
  caller-passed flag, so a future caller that forgets the flag cannot silently disable review.
- Any resume-identity concept must work for review-only workflows, which have no durable write step;
  rules out reusing `workflowSnapshot.invocationId` as-is.
- Preserve current behavior at both ends: a retry or resume after a landing/publication failure
  still reuses the checkpoint without re-invoking review roles, and a new dispatch still re-runs it.
- Rules out removing the checkpoint; it exists to stop publication retries from re-running review,
  which is expensive and non-deterministic.

## Acceptance criteria

- [ ] Checkpoint reuse is decided from state the lookup itself carries, not from a boolean threaded
      through the dispatch path.
- [ ] A new dispatch on a branch holding a completed review checkpoint re-runs review; a retry or
      resume after a landing or publication failure reuses it without re-invoking review roles.
- [ ] Both properties hold for a review-only workflow (no durable write step) and for an
      implement-plus-review workflow.
- [ ] A caller that omits any dispatch-identity argument cannot silently get cross-dispatch reuse —
      the failure mode is a type or an explicit error, not a skipped review.
- [ ] Regression coverage fails against a lookup that ignores dispatch identity.

## Documentation updates

- `v2/docs/workflow-runner.md` — checkpoint identity and its retry scope.
