---
name: review-actuator-staged-markdown-lint-subspec-too-big-and-breaks-review-dispatch-fixtures
---

# Review-actuator staged-Markdown lint subspec is too big for one iteration and its gate breaks 13 review-dispatch test fixtures

## Problem

The spec `20260807T160744Z-plan-review-actuator-staged-markdown-lint` (plan merged #2710) did not land: its single subspec is too large for one write iteration and its new gate breaks existing tests.

1. **Too big — 45-min `iteration_timeout`.** The plan-review verdict expanded the subspec to wire the post-actuator lint on ALL promotion admission paths (`landReviewedOutputOrFail`, `finishReviewedLanding`, `resumePopulatedIntentPublication`) plus reprompt + exhaustion + 5 doc updates. Implement run `3d5f8270` ran the full 45 minutes → `iteration_commit_failed` (biome `noExcessiveCognitiveComplexity` on `runReviewDebateStep`) → harness resume `unsupported_resume_context`.
2. **Gate breaks 13 existing tests.** The new gate lints staged Markdown on every reviewed landing. 13 `executeWorkflow review dispatch` tests in `workflow-runner.test.ts` (idleOutputMs propagation, reviewed-intent review/landing, checkpoint re-entry, retry-without-rerun) now settle `landing_failed` instead of `complete` because their staged-Markdown fixtures are not lint-clean. The agent timed out before reconciling them.

The feature itself is sound (adversarial review confirmed: all three admission paths lint; reprompt/exhaustion correct; disabling the shared lint returns reddens all three feature tests).

## Findings to reuse (do not rediscover)

- **Split** into: (00) shared `reviewed-staged-markdown-lint.ts` module + gate on the primary path (`landReviewedOutputOrFail`) + block/reprompt/exhaustion tests; (01) wire remaining admission paths (`finishReviewedLanding`, `resumePopulatedIntentPublication`) + fixture reconciliation for the 13 review-dispatch tests; (02) 5 doc updates. Add a `biome-ignore lint/complexity/noExcessiveCognitiveComplexity` on `runReviewDebateStep` (established pattern in the file).
- **Correct mutation checkpoint (the plan's was hollow):** the feature has defense-in-depth (two gates both call `lintReviewedStagedMarkdownOrFail`), so a `@mutate` on either single guard in `workflow-runner.ts` false-GREENs (the sibling gate masks it). The one load-bearing point is `reviewed-staged-markdown-lint.ts` `lintReviewedStagedMarkdownOrFail`: directive `// @mutate v2/src/execution/reviewed-staged-markdown-lint.ts "if (result.kind === \"clean\") return { kind: \"pass\" };" -> "if (true) return { kind: \"pass\" };"` reddens the `blocks completion before landing` test BEHAVIORALLY (hand-verified). Criterion must name that test and point the directive at this file, not `workflow-runner.ts`.
- **Fixture reconcile:** the 13 failing review-dispatch tests need lint-clean staged Markdown (or a shared clean-staging helper). Root cause is uniform (dirty fixtures → gate blocks), so a shared fixture helper likely greens all 13.

## Acceptance criteria

- [ ] Split so each subspec completes in one write iteration; the primary-path gate + block/reprompt/exhaustion tests land first.
- [ ] All prior `executeWorkflow review dispatch` tests stay green (fixtures reconciled to lint-clean staged Markdown).
- [ ] Mutation checkpoint targets `reviewed-staged-markdown-lint.ts`'s clean-result guard as above; hand-verified to redden behaviorally.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`, `v2/docs/prompts.md` — post-actuator staged-Markdown lint gate, reprompt/exhaustion.
