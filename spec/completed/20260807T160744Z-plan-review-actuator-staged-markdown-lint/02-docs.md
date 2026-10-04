# Docs

## Problem

Once the post-actuator staged-Markdown lint gate is live on all review admission paths (subspecs `00`, `01`), the durable docs must record it.

## Prerequisites

- Subspecs `00` and `01` merged: the gate is wired into `landReviewedOutputOrFail`, `finishReviewedLanding`, and `resumePopulatedIntentPublication` with reprompt + exhaustion.

## Decision ledger

- Document the gate, its admission paths, reprompt/exhaustion semantics, and resume behavior across the durable docs below — rules out an undocumented behavior change.

## Work

- Update the five docs listed under Documentation updates.

## Acceptance criteria

- [x] `v2/docs/workflow-runner.md` documents that plan/intent review re-lints staged Markdown after the actuator and before completion landing on all promotion admission paths (`landReviewedOutputOrFail`, `finishReviewedLanding`, `resumePopulatedIntentPublication`), with reprompt and exhaustion semantics.
- [x] `v2/docs/write-behavior.md` documents the post-actuator staged-Markdown lint on the review completion seam.
- [x] `v2/docs/v1-behaviors.md` records the post-actuator staged-Markdown lint gate for plan/intent review.
- [x] `v2/docs/prompts.md` documents cross-behavior reuse of `write.staged-markdown-lint-reprompt` on the review path.
- [x] `v2/docs/operator-runbook.md` documents `landing_failed` + resume guidance when the lint-reprompt budget is exhausted.
- [x] `bun run lint:md` passes.

## Documentation updates

This subspec is the documentation update for the slice.
