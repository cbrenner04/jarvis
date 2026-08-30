# In-loop equivalent-mutation acceptance and reprompt budget exhaustion

## Problem

Behavior-neutral mutations need an exact `// @mutate-equivalent` escape hatch at the same lifecycle point that discovers survivors, and reprompt budget exhaustion must not invent a new terminal outcome.

## Decision ledger

- In-loop verification honors exact equivalent-mutation directives through the unchanged `verifyDiffDerivedMutations` acceptance path; rules out a parallel directive parser or reprompting an accepted site.
- Reprompt budget exhaustion with a still-surviving mutation settles `surviving_mutation_failed` with `resumable: true` and the same surviving-mutation detail as today's publication-time discovery; rules out `blocked`, `contract_miss`, or silent completion.
- In-loop budget exhaustion admits implement `jarvis run resume` only (`nextAction: resume` on the implement write row); rules out review `write.mutation-repair` admission on implement-row exhaustion (that path is publication/review-time only per subspec 03).

## Prerequisites

- Subspec 00 lands in-loop diff-derived verification and surviving-mutation reprompt wiring.

## Task checklist

- Ensure the subspec 00 in-loop call passes through `verifyDiffDerivedMutations` `pass` / `acceptedSites` for an exact colocated directive without reprompting.
- Add `write-loop.test.ts` regression: exact `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` on the mutated physical line accepts that site and does not reprompt.
- Add `write-loop.test.ts` regression: keep a surviving mutation through `maxIterations`; assert terminal `surviving_mutation_failed` / `resumable: true` with surviving-mutation detail and implement `jarvis run resume` admission, matching today's publication-only discovery settlement.

## Acceptance criteria

- [ ] `write-loop.test.ts` `implement complete honors exact mutate-equivalent directive in-loop` drives `patch.prompt.body` to `done` with an uncovered guard and an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` on the mutated line; asserts no `surviving_mutation_reprompt` and completion without publication-time `surviving_mutation_failed`; fails against the pre-fix publication-only verification path.
- [ ] `write-loop.test.ts` `implement complete surviving mutation reprompt budget exhaustion settles surviving_mutation_failed` keeps a surviving mutation through `maxIterations`; asserts terminal `surviving_mutation_failed` with `resumable: true`, surviving-mutation source detail, and `nextAction: resume` (implement `jarvis run resume`), not `blocked`, `contract_miss`, or review `write.mutation-repair`; fails against the pre-fix loop that only discovers survivors at publication.

## Documentation updates

- Deferred to subspec 04.
