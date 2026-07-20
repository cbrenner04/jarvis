# Deferred review landing is generic over PublicationLanding

## Problem

`jarvis run workflow plan --review-passes 1 --review-behavior light` publishes a PR
containing only `.jarvis-plan-stage/` and no spec dir; plain `plan` lands the same
intent correctly. When review is the last step, the write step defers its landing
(`workflow-runner.ts` `isReviewLastStep` guard). But the review step only performs a
deferred landing when `landing?.kind === "intent-stage"` — every other tail branch in
`runStandardReviewStep`/`runProfileReviewStep` returns `complete` without landing. The
plan review step is also built with no `landing` at all. So a deferred `plan-tree`
landing is never executed: the staged tree is dropped and the durable `v2/spec/...`
dir is never created.

`landPublication` already dispatches correctly over all three landing kinds. The gap
is only in the review step's deferred-landing resumption, which is hardcoded to
`intent-stage` instead of mirroring `landPublication`.

## Decisions

- The review step executes its deferred landing through the generic `landPublication` dispatch, not a per-kind hook — rules out adding a second `plan-tree`-specific branch alongside the `intent-stage` one.
- The plan review step carries the write step's `plan-tree` landing and its verdict/spec context points at the stage (`.jarvis-plan-stage/`), not the not-yet-landed durable dir, so critic/actuator read and edit the tree that actually lands — rules out reviewing/editing the empty durable path and then landing the unedited draft (drops review edits).
- Verdict handling (verdict excluded from the landed tree, stage + verdict retained on landing failure) is generic over landing kind; the landed plan tree omits `verdict-plan.md` — rules out the prior "plan keeps its durable `verdict-plan.md`" behavior.
- The generic (plan) review landing stays non-durable — no durable run row or post-review checkpoint — rules out promoting it to a durable step; durability of generic review steps is out of scope (`review-step-emits-log-events`).

## Task checklist

- [ ] Thread the write step's `plan-tree` landing onto the plan review step in `buildPlanWorkflowSteps` and point its verdict/spec context at `.jarvis-plan-stage/`.
- [ ] Make the review step's deferred-landing tail execute `landPublication` for any non-`none` landing kind, replacing the `intent-stage`-only gate.
- [ ] Generalize verdict exclude/restore so it applies to the deferred landing regardless of kind; on landing failure return a resumable `invocation_failure` and retain the stage.
- [ ] Add a regression test driving a reviewed plan run to landing.
- [ ] Update `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] A reviewed plan run (`--review-passes 1`, light or debate) lands its staged tree: after the review step completes, the durable spec dir exists with `index.md`, `intent.md`, and at least one `NN-*.md`, and `.jarvis-plan-stage/` is consumed (removed).
- [ ] Actuator spec edits made during plan review are present in the landed durable tree.
- [ ] The landed plan tree does not contain `verdict-plan.md`.
- [ ] When the deferred plan landing fails, the review step returns a resumable `invocation_failure` and the stage (including the verdict) is retained.
- [ ] A regression test drives a reviewed **plan** run through review to a landed spec tree and asserts the durable dir is created and the stage consumed; it fails against the pre-fix code (which strands the stage and lands nothing) and passes after the change.
- [ ] Existing reviewed-intent landing tests in `workflow-runner.test.ts` stay green (intent landing behavior unchanged by the generalization).
- [ ] The existing `executeWorkflow plan review dispatch` test in `workflow-runner.test.ts` stays green.

## Documentation updates

- `v2/docs/workflow-runner.md`: update the verdict/landing section so deferred-review landing is described as generic over landing kind (plan and intent), and correct the "Plan keeps its durable `verdict-plan.md`" statement to reflect that the plan verdict is excluded from the landed tree.
- `v2/docs/v1-behaviors.md`: not applicable — the reviewed-plan workflow is a v2-only feature with no v1 parity entry.
