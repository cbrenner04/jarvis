---
name: resume-durable-review-mutation-tail
---

# Resume a durable review row through its mutation-publication tail

## Problem

`jarvis run resume` refuses a durable `implement-review` row whose `loop_finished` record reports `surviving_mutation_failed` and `resumable: true`, returning `resume_unsupported` because the row is not an executable write step. `list` and `wait` then project the row as non-resumable, contradicting both the terminal record and the documented recovery. Observed 2026-07-26 on run `0c81e851`.

## Decisions

- Admit a durable review-behavior row only when the same workflow has a completed sibling durable write row and its persisted state supports the mutation re-verification, ready-gate, and publication tail; rules out executable-write-step kind alone or unrelated review rows as the admission predicate.
- Resume only the surviving-mutation tail after the completed write step; rules out re-invoking its agent or replaying the workflow.
- Give the row one resumability answer across `loop_finished`, `list`, `wait`, and resume admission; rules out fixing dispatch while retaining contradictory projections.
- Keep the workflow entry id and completed `~shrink` row non-resumable for a review-owned failure; rules out redirecting recovery to a sibling row.

## Acceptance criteria

- [ ] Resuming a durable `implement-review` row after `surviving_mutation_failed`, with a completed sibling durable write row from the same workflow, replays mutation re-verification, the ready gate, and publication instead of returning `resume_unsupported`.
- [ ] The same resume records zero additional write-step agent invocations.
- [ ] A durable `review-debate` last-step row in the same state resumes through the same tail.
- [ ] A review row without a completed sibling durable write row from the same workflow refuses this recovery.
- [ ] The row's `loop_finished`, `list`, and `wait` resumability agree with resume admission.
- [ ] The workflow entry id and a completed `~shrink` row still refuse this review-owned recovery.
- [ ] `v2/src/execution/workflow-runner.test.ts`'s `resuming a review row's surviving_mutation_failed actually re-runs the ready finalizer (mutation reverification)` regression fails against the baseline and passes with the durable-review-tail admission rule.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and § Publication / completion failures — replace the false recovery claim with the shipped durable-review-tail admission rule.
- `v2/docs/daemon-host.md` — document durable review-row resume admission and consistent resumability projection.
- `v2/docs/v1-behaviors.md` — record the corrected review-row recovery contract.

## Prerequisites

- A durable review-behavior row can own `surviving_mutation_failed` after its sibling write step completes and retains the workflow state needed to reconstruct finalization.
