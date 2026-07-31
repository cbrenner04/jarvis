# 02 - Landing contract reprompt before settle

## Problem

`executeIntentSplitWrite` accepts `done` when `.jarvis-intent-stage/` is non-empty;
`landIntentWorkflowOutput` / `landPublication` then validates shape and the workflow
settles `landing_failed` after the write agent is gone. Operators hand-edit the stage
and `jarvis run resume`. The harness already reprompts on `missing_blocker`; landing
shape violations need the same in-loop recovery within the iteration budget.

## Decisions

- Run `validateIntentStage` shape checks (post-repair, pre-rogue-file scan) on
  `intent.prompt.split` writes before the write loop commits `complete` — rules out
  reprompt only at deferred `landPublication` / review-last landing time.
- Landing-contract miss reprompts the write agent with the validation error and
  offending staged file path within `maxIterations` — rules out settling
  `landing_failed` on the first violation.
- Deferred to first consumer: reprompt prompt id/template and delimiters for landing
  contract misses — pin when subspec 02 implements the reprompt call site.
- After the iteration budget is spent with the violation unfixed, the write loop
  settles `loopOutcomeKind: "landing_failed"` with stage contents intact and
  `resumable: true` / `nextAction: "resume"` — rules out `contract_miss` or
  removing the operator resume path.
- Review-last workflows inherit already-valid staging from the write step; deferred
  landing must not re-reprompt — rules out a second reprompt pass at
  `landReviewedPublicationOutput`.
- Out of scope: changing contract definitions (one-bullet-per-line, no ordering prefix);
  `NN-` prefix normalization (subspec 01); prompt text (subspec 00).

## Prerequisites

- `landIntentWorkflowOutput` validates staged ready-intents and settles `landing_failed`
  on shape violation (`v2/src/execution/intent-output.ts`, `workflow-runner.ts`).
- Write steps reprompt the agent on `missing_blocker` before settling
  (`step-runner.ts`, `write-loop.ts`).
- Subspec 01 merged when present — prefix normalization is not a reprompt target.

## Task checklist

- Add an intent-split landing-shape contract (or equivalent pre-completion gate) in
  `executeIntentSplitWrite` / write-loop wiring that calls `validateIntentStage` and
  surfaces `{ error, offendingFile }` on miss.
- Reprompt on miss with violation text and offending file; emit a durable log event
  (new kind or reuse an existing reprompt detail event — pin at implementation).
- On budget exhaustion, commit `landing_failed` from the write loop; preserve
  `.jarvis-intent-stage/` contents; keep workflow-tail `landing_failed` for
  non-repromptable faults (collision, I/O).
- Add workflow-level regressions for reprompt and exhausted-budget terminal settlement.

## Acceptance criteria

- [ ] `write-loop.test.ts` `intent split landing-contract violation reprompts before settle`
      drives `intent.prompt.split` with staged prerequisites prose violation, asserts a
      landing-contract reprompt carrying the validation message and offending file, and
      asserts the loop does not settle `landing_failed` on the first miss; it fails against
      the pre-fix code (which defers validation to `landPublication` and settles
      `landing_failed` immediately).
- [ ] `write-loop.test.ts` `intent split landing-contract budget exhaustion settles landing_failed`
      keeps the violation through `maxIterations`, asserts terminal `landing_failed` with
      `resumable: true`, stage bytes unchanged, and `composeRunOperatorError` projecting
      `nextAction: "resume"`; it fails against the pre-fix code.
- [ ] Inverting the pre-completion landing-validation guard (skip validation before accepting
      `done`) turns `intent split landing-contract violation reprompts before settle` RED; the
      pinning test names that mutation checkpoint.
- [ ] Inverting the budget-exhaustion `landing_failed` branch (settle `contract_miss` or
      `blocked` instead) turns `intent split landing-contract budget exhaustion settles
      landing_failed` RED; the pinning test names that mutation checkpoint.

## Documentation updates

- `v2/docs/write-behavior.md` — intent split landing contracts are validated before write-loop
  completion; which violations reprompt vs which are harness-normalized (ordering prefix).
- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining —
  settled `landing_failed` on the write step means the reprompt budget was already spent;
  hand-edit + `jarvis run resume` remains the recovery when the agent did not fix in-loop.
- `v2/docs/v1-behaviors.md` — intent landing shape violations reprompt during the write loop;
  terminal `landing_failed` after budget exhaustion.
