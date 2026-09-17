---
name: recover-admits-landing-failed-plan-write-row
---

# `pipeline recover` admits a `landing_failed` plan write row with a present staged tree

## Problem

`recoverPlanStage` admits only `blocked` plan write rows (`isBlockedPlanWriteRecoveryCandidate`, `v2/src/execution/workflow-runner-resume.ts:616`) or completed drafts with a failed review sibling (`:629`). A `landing_failed` plan write row is refused `unrelated_plan_stage`; `run resume` refuses, and `pipeline resume` only redrafts and reproduces the failure. A hand-corrected staged tree cannot be re-landed. Intent review rows already admit populated-stage resume; plan write rows have no equivalent.

## Decisions

- `recoverPlanStage` admits a `landing_failed` plan write row whose staged tree is present, revalidating and landing the existing tree without redrafting.
- Admission requires a present staged tree; an absent or empty stage keeps the current `unrelated_plan_stage` refusal, so recover never silently produces an empty spec.
- Recovery re-runs the normalizer and staged lint on the hand-corrected tree; rules out landing unvalidated operator edits.

## Acceptance criteria

- [ ] A recovery test asserts `recoverPlanStage` admits a `landing_failed` plan write row with a corrected staged tree and lands it; it fails against the current `unrelated_plan_stage` refusal.
- [ ] A recovery test asserts a `landing_failed` plan write row with no staged tree is still refused `unrelated_plan_stage`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Prerequisites

- The decisions-ledger prompt guidance requires a Markdown bullet list rather than one entry per bare line.
- The plan-draft normalizer converts bare lines under `## Decisions` into bullets before staged lint runs.
- A plan write-step staged-lint failure reprompts the drafter and only settles `landing_failed` with the staged tree preserved once the reprompt budget is exhausted.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline recover — `landing_failed` plan write rows with a present staged tree are recoverable.
- `v2/docs/v1-behaviors.md` — record the widened recover admission.
