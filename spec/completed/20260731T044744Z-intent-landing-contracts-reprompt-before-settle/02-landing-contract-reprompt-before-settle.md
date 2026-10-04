# 02 - Landing contract reprompt before settle

## Problem

`executeIntentSplitWrite` accepts `done` when `.jarvis-intent-stage/` is non-empty;
`landIntentWorkflowOutput` / `landPublication` then validates shape and the workflow
publication tail settles `landing_failed` after the write loop has already completed.
Operators hand-edit the stage and `jarvis run resume`. The harness already reprompts on
`missing_blocker`; landing shape violations need the same cross-iteration recovery within
the iteration budget.

## Decisions

- Pre-completion gate on `intent.prompt.split` writes: after prefix normalize and content
  repair, validate landing shape before the write loop accepts `complete` — rules out
  reprompt only at deferred `landPublication` / review-last landing time.
- Landing-contract miss takes a write-loop `continue` path that consumes `maxIterations`
  across separate loop iterations — distinct from terminal `contract_miss` (first-miss exit)
  and from `missing_blocker` (in-step sub-invocation); rules out first-miss
  `landing_failed` or deferring loop-control semantics.
- Landing-shape misses reprompt the write agent with violation text and offending staged
  file path; they do not use `contract_miss` or `appendBlockerToSpec` on `specPath`.
- Violation taxonomy:
  - `NN-` ordering prefix → harness normalize (subspec 01)
  - Agent-fixable shape (prerequisites prose, `name:`/slug mismatch, H1, missing
    `## Prerequisites`, etc.) → reprompt within budget
  - Non-repromptable (rogue path, duplicate/collision after normalize, empty stage, I/O)
    → immediate terminal `landing_failed` without spending reprompt budget
- Pre-completion gate uses the same `modifiedPaths` source as `landIntentWorkflowOutput`
  so rogue-path behavior does not diverge between write-loop validation and deferred landing.
- Validation (or a wrapper) returns `{ error, offendingFile }` on miss; first failing file
  wins when multiple staged files violate.
- After the iteration budget is spent with the violation unfixed, the write loop settles
  `loopOutcomeKind: "landing_failed"` with stage contents intact and `resumable: true` /
  `nextAction: "resume"`; `jarvis run resume` on that write row re-enters the write loop via
  existing `reconstructWriteResume` plumbing — distinct from review-row finalization replay
  (`resolveIntentFinalizationResumeContext`).
- Review-last workflows inherit already-valid staging from the write step; deferred landing
  must not emit a second landing-contract reprompt pass.
- Workflow-tail `landing_failed` for non-repromptable faults (collision, I/O) stays on the
  publication tail unchanged.
- Out of scope: changing contract definitions (one-bullet-per-line, no ordering prefix);
  `NN-` prefix normalization (subspec 01); prompt text (subspec 00).

## Prerequisites

- `landIntentWorkflowOutput` validates staged ready-intents and settles `landing_failed`
  on shape violation (`v2/src/execution/intent-output.ts`, `workflow-runner.ts`).
- Write steps reprompt the agent on `missing_blocker` before settling
  (`step-runner.ts`, `write-loop.ts`).
- Subspec 01 merged when present — prefix normalization is not a reprompt target.

## Task checklist

- Add intent-split landing-shape pre-completion gate in `executeIntentSplitWrite` /
  write-loop wiring that runs `validateIntentStage` (post-normalize, post-repair) with
  `modifiedPaths` parity and surfaces `{ error, offendingFile }` on miss.
- On miss, `continue` the write loop with a landing-contract reprompt (violation + offending
  file); emit a durable log event (new kind or reuse — pin at implementation).
- On budget exhaustion, commit write-loop `landing_failed`; preserve `.jarvis-intent-stage/`
  contents; keep workflow-tail `landing_failed` for non-repromptable faults.
- Add write-loop, workflow, and daemon regressions for reprompt, exhausted-budget terminal
  settlement, write-row resume, and review-last non-reprompt inheritance.

## Acceptance criteria

- [x] `write-loop.test.ts` `intent split landing-contract violation reprompts before settle`
      drives `intent.prompt.split` with staged prerequisites prose violation, asserts a
      landing-contract reprompt carrying the validation message and offending file, asserts the
      loop `continue`s (consumes iteration budget) without terminal `landing_failed` on the
      first miss, and asserts no `contract_miss` / `appendBlockerToSpec` on `specPath`; it
      fails against the pre-fix code (write loop completes, then publication tail settles
      `landing_failed`).
- [x] `write-loop.test.ts` `intent split landing-contract budget exhaustion settles landing_failed`
      keeps the violation through `maxIterations`, asserts terminal write-loop `landing_failed`
      with `resumable: true` and stage bytes unchanged; it fails against the pre-fix code.
- [x] `daemon-resume.test.ts` `resumes write-step intent-split landing_failed via reconstructWriteResume`
      drives budget-exhausted write-row `landing_failed`, asserts `jarvis run resume` admits via
      `reconstructWriteResume` (not `resolveIntentFinalizationResumeContext`) and re-enters the
      write loop with staged bytes intact; it fails against the pre-fix code.
- [x] `workflow-runner.test.ts` `review-last deferred landing does not reprompt on already-valid staging`
      asserts write-step pre-completion validation leaves valid staging and deferred landing lands
      without a landing-contract reprompt event; it fails against the pre-fix code if deferred
      landing re-validates with a second reprompt pass.
- [x] `intent-output.test.ts` `rejects differing collisions without overwrite` stays green
      (workflow-tail non-repromptable `landing_failed` unchanged).
- [x] Skipping the pre-completion landing-validation guard (accept `done` before shape validate)
      turns `intent split landing-contract violation reprompts before settle` RED; the pinning
      test names that mutation checkpoint.
- [x] Inverting the budget-exhaustion `landing_failed` branch (settle `contract_miss` or
      `blocked` instead) turns `intent split landing-contract budget exhaustion settles
      landing_failed` RED; the pinning test names that mutation checkpoint.

## Documentation updates

- `v2/docs/write-behavior.md` — intent split landing contracts are validated before write-loop
  completion; violation taxonomy (normalize vs reprompt vs immediate terminal).
- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining —
  split write row vs review row: **write row** (`runId` on the intent-split write step) settled
  `landing_failed` means the reprompt budget was already spent — hand-edit
  `.jarvis-intent-stage/` and `jarvis run resume` re-enters the write loop via
  `reconstructWriteResume`; **review row** (`runId` on the review/finalization step) settled
  `landing_failed` with populated stage replays finalization only
  (`resolveIntentFinalizationResumeContext`), not the write loop.
- `v2/docs/v1-behaviors.md` — intent landing shape violations reprompt during the write loop;
  terminal write-loop `landing_failed` after budget exhaustion; publication-tail `landing_failed`
  unchanged for non-repromptable faults.
