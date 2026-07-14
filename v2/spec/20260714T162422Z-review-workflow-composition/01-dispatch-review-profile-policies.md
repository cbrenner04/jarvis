# Dispatch review through profile policies

The workflow runner has domain-specific context branches and duplicated enforcement/landing paths. Route every optional review through the profile while preserving each domain's safety contract.

## Decisions

- Carry `ReviewPromptProfile` on review steps and dispatch light or debate once by behavior; rules out `deferredIntentOutput`, `planReviewContext`, and `patchReviewContext` runner branches.
- Interpret profile-selected verdict and write-boundary policies in one enforcement path; rules out a generic least-restrictive boundary shared by all domains.
- Preserve intent verdict ownership and collision rejection, retain verdict diagnostics on review or landing failure, exclude the verdict from validation and landing, and remove it only after successful landing; rules out reusable or eagerly cleaned intent verdicts.
- Preserve plan's durable in-tree verdict and actuator spec edits; rules out applying intent cleanup or implement immutability to plan review.
- Preserve implement's immutable completed spec tree while permitting implementation edits; rules out a mutable-spec actuator boundary.
- Resolve every review cwd from its existing workflow worktree, including reviewed intent's external worktree; rules out a dedicated reviewed-intent cwd branch.
- Resume reviewed intent from its completed-review or landing-failed checkpoint without reinvoking roles; rules out replaying review after a post-write landing failure.
- Delete replaced runner branches and enforcement copies with net deletion across those existing surfaces; rules out retaining old paths behind the profile abstraction.

## Task checklist

- Emit profile-bearing review steps from intent, plan, and implement builders/loaders.
- Replace domain review branches with one light/debate runner dispatch.
- Unify verdict, boundary, landing, retry, telemetry, progress, and completion handling behind profile policies.
- Remove replaced context fields, executor adapters, and enforcement copies.
- Align workflow and operator documentation.

## Acceptance criteria

- [ ] New profile-dispatch cases in `workflow-runner.test.ts` fail against the baseline and pass when intent, plan, and implement light/debate steps enter one runner dispatch; reviewed intent uses its existing external worktree cwd.
- [ ] Assertions from `review-intent-enforcement.test.ts` and reviewed-intent cases in `workflow-runner.test.ts` stay green after migration for verdict ownership/collision rejection, boundary restoration, diagnostic retention, validation/landing exclusion, cleanup only after successful landing, and landing-only resume without role reinvocation.
- [ ] Plan review assertions in `workflow-runner.test.ts` and `render-plan-review-prompts.test.ts` stay green after migration for durable `verdict-plan.md`, critic read-only enforcement, actuator edits, retry, and landing behavior.
- [ ] Implement light/debate assertions in `workflow-runner.test.ts`, `review-debate-render.test.ts`, and `implement-workflow-steps.test.ts` stay green after migration for immutable specs, implementation edits, verdict placement, eligibility, cycle limits, role order, telemetry, completion attribution, and implement-worktree execution.
- [ ] `deferredIntentOutput`, `planReviewContext`, and `patchReviewContext` are absent from runtime step contracts and dispatch; light and debate remain the only review cycle behaviors.
- [ ] Replaced runner, render, and enforcement production surfaces show net deletion, with no parallel legacy dispatch or enforcement path retained.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md` documents unified dispatch, profile-selected enforcement, resume/landing, and cwd; `v2/docs/first-workflow-walkthrough.md` describes common light/debate semantics.

## Documentation updates

- `v2/docs/workflow-runner.md` — unified dispatch, policies, resume, landing, and cwd.
- `v2/docs/first-workflow-walkthrough.md` — common light/debate operator semantics.
