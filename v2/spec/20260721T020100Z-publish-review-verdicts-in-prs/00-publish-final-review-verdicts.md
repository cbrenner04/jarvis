# Publish final review verdicts

Reviewed workflows persist their final verdict in the worktree, but reviewed-plan landing currently excludes it from the durable spec tree. Land the established verdict artifact with reviewed plan and implementation completion so the published branch carries the review record.

## Decisions

- Land `verdict-plan.md` at the durable plan spec root and `verdict-patch.md` beside the implemented spec; rules out PR-body duplication.
- Publish the final overwritten artifact verbatim, including a zero-byte verdict; rules out synthesizing summaries or treating empty as absent.
- Reuse the completed-review landing/publication checkpoint on retry; rules out reinvoking review roles to recreate the verdict.
- Scope that reuse to the retry itself: a checkpoint is a retry aid, not a cross-dispatch cache. A new
  workflow dispatch on the same `(project, branch, stepId)` re-runs review; rules out inheriting a prior
  dispatch's verdict, which would silently skip review altogether. The daemon marks every dispatch
  `freshDispatch`; retries and resumes do not.
- Exclude reviewed-intent verdicts; rules out inventing parity absent from v1's reviewed-intent contract.

## Tasks

- Include the final plan verdict in transactional `plan-tree` landing for light and debate review.
- Pin implementation completion publication to the existing verdict artifact and shared completion commit.
- Cover final-cycle, empty-verdict, and landing/publication retry behavior.
- Align durable workflow, lifecycle, architecture, and v1-parity docs.

## Acceptance criteria

- [ ] A reviewed plan's landed spec tree contains the final cycle's exact `verdict-plan.md` for both light and debate review, including a zero-byte no-findings verdict.
- [ ] A reviewed implementation's completion snapshot contains the final cycle's exact `verdict-patch.md`, including a zero-byte no-findings verdict.
- [ ] Retrying reviewed-plan landing or either workflow's completion publication preserves the recorded verdict and does not invoke review roles again.
- [ ] A second workflow dispatch on a branch that already holds a completed review checkpoint re-runs review; it does not reuse the prior dispatch's checkpoint. Coverage asserts the critic is invoked on both dispatches, and fails if checkpoint reuse is not scoped to retries.
- [ ] Updated cases in `v2/src/execution/workflow-runner.test.ts` fail against the pre-fix reviewed-plan landing behavior and pass for light review, debate review, implementation review, empty verdicts, and retry without review reinvocation.
- [ ] `v2/src/execution/publication-landing.test.ts` stays green for transactional plan-tree landing and idempotent retry behavior.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/v2-architecture.md`, and `v2/docs/v1-behaviors.md` describe PR-visible final verdict publication and retry lifecycle without extending it to reviewed intents.

## Documentation updates

- `v2/docs/workflow-runner.md` — reviewed plan and implementation verdict publication and retry.
- `v2/docs/write-behavior.md` — final verdict lifecycle after successful review.
- `v2/docs/v2-architecture.md` — final verdict ownership at the reviewed-spec completion boundary.
- `v2/docs/v1-behaviors.md` — v2 parity for PR-visible plan and implementation verdicts.
