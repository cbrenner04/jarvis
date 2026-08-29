---
name: recover-review-failed-plan-draft
---

# Recover a review-failed plan draft without redrafting

## Prerequisites

## Primary implementation surface

- execution-loop

## Problem

- `recoverPlanStage` admits only blocked plan-write runs, so a completed write followed by a failed review cannot reuse the valid `.jarvis-plan-stage/` tree.
- Re-running the workflow invokes the plan writer again even though drafting already succeeded.

## Behavior

- An operator-requested recovery accepts durable evidence that the plan write completed, a later review step failed by stall, quota, or invocation error, and the staged plan tree remains populated and valid.
- Recovery revalidates and reviews the existing staged tree, lands it on success, and never invokes the plan writer.
- Another failed recovery review preserves the staged tree and stops for operator action without automatic retry.
- A failed plan write or missing valid staged tree remains ineligible.

## Decisions

- Require a completed plan-write row plus its failed review sibling; rules out treating any failed workflow with leftover staging as recoverable.
- Reuse the existing plan-stage validation, review, landing, and completion-commit path; rules out a weaker direct-copy recovery that bypasses review contracts.
- Make each recovery attempt explicit and single-shot; rules out an automatic review retry loop on content-specific failures.
- Leave write-step failures on the existing failure path; rules out masking an incomplete draft as review-only failure.

## Acceptance criteria

- [ ] A plan workflow seeded with a completed write row, a failed review row, and a valid populated `.jarvis-plan-stage/` recovers through validation, review, landing, and commit with zero plan-writer invocations.
- [ ] A stalled, quota-exhausted, or otherwise failed recovery review leaves the staged tree intact and performs no automatic retry or redraft, pinned by tests.
- [ ] A failed write row or absent/invalid staged tree remains refused, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan-stage recovery eligibility and the review-only, single-shot recovery path.
- `v2/docs/v1-behaviors.md` — record the changed recovery behavior in the v1 parity baseline.
