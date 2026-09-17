---
name: plan-landing-lint-is-recoverable
---

# Plan drafts don't strand on a ledger/lint conflict, and a plan write-step `landing_failed` is recoverable

## Problem

Issue #3949. Two coupled defects, both unfixed on `main`:

1. **Prompt vs. lint.** `prompts/plan/decisions-ledger.md:8` asks for decisions "as a ledger of atomic entries, one per line". Models that take that literally write bare consecutive lines, which Markdown reads as one soft-wrapped paragraph, and the `no-hard-wrap` staged lint rejects every such draft identically.
2. **No recovery.** The plan write step then settles `landing_failed` / `resumable: false`. `run resume` refuses; `pipeline recover` refuses `unrelated_plan_stage` because `recoverPlanStage` admits only `blocked` drafts (`isBlockedPlanWriteRecoveryCandidate`, `v2/src/execution/workflow-runner-resume.ts:616`) or completed drafts with a failed review sibling (`:629`); `pipeline resume` only redrafts and reproduces the failure. A hand-corrected staged tree cannot be re-landed.

## Evidence

Issue #3949: pipeline `0676c490`, lane `plan-accepts-and-validates-base-flag`, runs `635c94bc` and `11fc404b`, both `landing_failed` on `no-hard-wrap` (3 strands total); feature hand-landed as #3948. 2026-09-17: an intent landing failed on staged-markdown lint (a trailing blank line after hand-correction), recovered only because intent review rows do admit populated-stage resume — plan write rows have no equivalent.

## Decisions

- The decisions-ledger prompt requires a Markdown bullet list (`- entry`), not "one per line". Rules out relying on `reflow:md`, which would merge separate entries.
- The plan-draft normalizer additionally converts a run of bare non-blank lines directly under `## Decisions` into bullets before staged lint, so an older or disobedient drafter still lands.
- A plan write-step `landing_failed` caused by staged-markdown lint first reprompts the drafter with the lint output (as the review-path post-actuator lint does), within the existing reprompt budget.
- If the reprompt budget is exhausted, the row is recoverable: `pipeline recover` admits a `landing_failed` plan write row whose staged tree is present, revalidating the hand-corrected tree without redrafting.

## Acceptance criteria

- [ ] A prompt-render test asserts the decisions-ledger guidance names a bullet list; it fails against the current "one per line" text.
- [ ] A normalizer test asserts bare consecutive lines under `## Decisions` become bullet items and the result passes staged lint; it fails against the current normalizer.
- [ ] A write-loop test asserts a plan draft failing staged lint is reprompted with the lint output before settling.
- [ ] A recovery test asserts `recoverPlanStage` admits a `landing_failed` plan write row with a corrected staged tree and lands it; it fails against the current `unrelated_plan_stage` refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline recover — `landing_failed` plan rows are recoverable.
- `v2/docs/spec-guidance.md` — ledger is a bullet list.
