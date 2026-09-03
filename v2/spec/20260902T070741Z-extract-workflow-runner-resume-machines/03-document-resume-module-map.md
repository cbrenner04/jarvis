# Document resume module map

## Problem

After extraction, resume-machine ownership is implicit in file placement; `workflow-runner.md` still states resume machines remain in `workflow-runner.ts`, and `v1-behaviors.md` still cites `workflow-runner.ts` for moved resume entrypoints.

## Surface

Primary: `v2/docs/workflow-runner.md`. In-scope: `v2/docs/v1-behaviors.md` source-path pointers for moved resume symbols.

## Prerequisites

- Subspec 00 complete: `workflow-runner-resume.ts` owns moved resume entrypoints.

## Decision ledger

- Update the existing `## Module map` section; rules out burying ownership only in inline comments.
- Document `workflow-runner-resume.ts` as owner of plan recovery (`recoverPlanStage`), intent-finalization resume (`resumePopulatedIntentPublication`), review-mutation resume (`resumeReviewMutationFinalization`), shared `landReviewedPublicationOutput`, and admission resolvers; rules out claiming debate-landing or step-loop ownership in this slice.
- Document that `workflow-runner.ts` imports resume entrypoints for step dispatch and `REVIEW_DEBATE_LANDING_DEPS`; `workflow-runner-debate-landing.ts` receives `landReviewedPublicationOutput` from the resume module via `workflow-runner.ts` wiring; rules out module-map prose that implies resume symbols still live in `workflow-runner.ts`.
- Document `reviewCompletionAgent` and `reviewCompletionPass` stay in `workflow-runner.ts` and feed `REVIEW_DEBATE_LANDING_DEPS` from there; rules out module-map prose that relocates them to resume.
- Update `v1-behaviors.md` `Sources:` paths that name `workflow-runner.ts` for `recoverPlanStage`, `resumePopulatedIntentPublication`, and `landReviewedPublicationOutput` to `workflow-runner-resume.ts`; rules out leaving stale source pointers after a behavior-preserving move.
- Behavior-preserving move only; rules out settlement-semantics edits in either doc.

## Task checklist

- Replace the stale `workflow-runner.ts` module-map bullet that says resume machines remain inline.
- Add a `workflow-runner-resume.ts` module-map entry covering ownership and import boundaries for daemon-callable resume entrypoints, `landReviewedPublicationOutput`, and stay-behind `reviewCompletionAgent` / `reviewCompletionPass` deps-bag wiring.
- Repoint `v1-behaviors.md` catalog `Sources:` entries for moved resume entrypoints from `workflow-runner.ts` to `workflow-runner-resume.ts`.

## Acceptance criteria

- [x] `v2/docs/workflow-runner.md` documents resume-machine ownership in a module map entry for `workflow-runner-resume.ts`, including import boundaries for `workflow-runner.ts`, debate-landing `landReviewedPublicationOutput` wiring, and stay-behind `reviewCompletionAgent` / `reviewCompletionPass` in `REVIEW_DEBATE_LANDING_DEPS`.
- [x] `v2/docs/v1-behaviors.md` `Sources:` paths for `recoverPlanStage`, `resumePopulatedIntentPublication`, and `landReviewedPublicationOutput` cite `workflow-runner-resume.ts` instead of `workflow-runner.ts`.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entries for resume-machine ownership and import boundaries.
- `v2/docs/v1-behaviors.md` — source-path pointers for moved resume entrypoints.
