## Verdict — required outcomes

**1. Newly emitted terminal records must reflect this resolver's retryability everywhere.**
`settleReviewMutationResumeFailure` (`v2/src/execution/workflow-runner.ts:2643-2664`) hardcodes `resumable: true` on the `loop_finished` it appends, while its callers settle outcomes that this tail's admission set does not accept. Result: the same row's terminal record says resumable while `list`, `wait`, and `resume` say `unsupported_resume_context` — exactly the three-surfaces-three-answers defect this spec exists to remove, reintroduced on a different emit site. The sibling emit site at `:2788` already got this right. Outcome: every `loop_finished` this resume path writes reports resumability derived from the same admission predicate, with coverage proving the settled-failure path agrees with `list`/`wait`/`resume`.

**2. The durability guard must match the codebase's tri-state convention.**
`step.durable` is documented as "absent means durable for legacy snapshots" (`state-store.ts:62`) and the rollup implements that as `if (step.durable === false) continue`. The new gate uses `step.durable !== true`, which treats a legacy absent field as non-durable — the opposite reading. Outcome: the guard rejects only explicitly non-durable review steps, still excluding the light `implement-review` per the spec decision, and stays consistent with the existing consumer.

**3. Do not narrow populated-intent `landing_failed` admission.**
A spec decision explicitly fences that path off from this change, yet `resolveReviewRowHead` is shared with `resolveIntentFinalizationResumeContext` and gained three new gates (durability, sibling-must-be-`completed`, invocation scoping). The pre-existing intent test at `workflow-runner.test.ts:6394` had to be given `setRunStatus(writeRunId, "completed")` to stay green — direct evidence the intent path's admission changed. The anchored daemon test passing does not establish behavior preservation. Outcome: the new admission gates apply only to the review-mutation tail, with the intent path's prior acceptance conditions demonstrably unchanged (including an intent row whose write sibling is not `completed`). If any narrowing is genuinely intended, it must be stated as a decision in the subspec and covered by a test that asserts the new refusal.

**4. Remove the now-false justification comment in the daemon.**
`v2/src/daemon/daemon.ts:1387` still cites `runtime_smoke_failed` as an outcome "this code can actually resume" to justify ordering the admission checks ahead of the generic terminal gate. That outcome is now explicitly excluded. Outcome: the comment states the ordering rationale in terms of the outcomes actually admitted.

**5. Close the coverage gaps behind two ticked acceptance criteria.**
- The criterion naming entry-row and `~shrink` refusal from `list` *and* `wait` is ticked, but the referenced daemon test asserts only `resume` refusals. Outcome: those rows' `list` and `wait` projections are asserted non-resumable.
- The same criterion's "a completed linked write sibling can supply context when it is also the workflow entry row" clause cannot occur as implemented — the entry row carries no `stepId`, so it never matches the sibling predicate. Outcome: either the scenario is made real and covered, or the clause is corrected in the subspec to state what is actually true.

**6. Prove rejection happens before side effects, not just that rejection happens.**
The five new guard tests assert only `{ ok: false }` from the resolver. The ordering in `resumeReviewMutationFinalization` is currently correct, but nothing fails if it regresses, while an acceptance criterion claims rejection precedes attempt creation and any committer/finalizer/publisher call. Outcome: at least one test drives a rejected row through the finalization entry point with throwing committer/publisher/ready-finalizer deps and asserts no attempt was recorded and no dep was invoked.

## Not upheld

- Fail-closed on differing candidate `specPath`/`worktreePath` across `~link-N` rows: each linked pass legitimately differs, and the spec's own decision names deterministic selection as the answer to multiplicity. Current project/branch/invocation scoping satisfies "conflicting-context."
- Excluding `runtime_smoke_failed`: an explicit spec decision, correctly documented.

## Optional, only if cheap

Selecting the terminal linked pass by the store's existing creation order (last-wins) rather than a completed-boundary timestamp with a row-ID tie-break would be simpler, remove the untested tie-break branch, drop the mixed `completedAt ?? createdAt` ordering key, and let the tie-break test shed its busy-wait. Separately, `resolveReviewRowHead` still computes a review-row-first `completionAgent` that the mutation path now recomputes and ignores — consolidating avoids a future edit silently doing nothing.