# Publication confirm-only mutation re-check

## Problem

Publication-time diff-derived verification must stay blocking for mutants introduced between in-loop pass and publication (for example ready-gate repair edits), but must no longer be the first discovery path for implement `done` survivors.

## Decision ledger

- Keep publication-time `verifyDiffDerivedMutations` blocking but confirm-only relative to in-loop discovery; rules out removing the publication gate or duplicating first-discovery reprompt at publication.
- Publication-time `surviving_mutation_failed` for repair-introduced mutants keeps existing review `write.mutation-repair` resume machinery; rules out terminal strand with only agent-free `jarvis run resume` as the recovery path.
- Publication-time repair survivors must not reprompt the live implement agent or re-enter the implement write loop; rules out `surviving_mutation_reprompt` or implement-loop re-entry at publication.

## Prerequisites

- Subspec 00 runs diff-derived verification in-loop on implement `done` before completion commit and publication.

## Task checklist

- Leave `runReadyFinalizer` / `verifyDiffDerivedMutations` publication hook in place; ensure implement runs that passed in-loop verification still re-check at publication and fail closed on a repair-introduced survivor.
- Add regression via count-based `verifyDiffDerivedMutations` seam on `WriteLoopInput`: in-loop call returns `pass`, publication `readyFinalizer` call returns `surviving-mutation`; assert `surviving_mutation_failed` on the review row with `write.mutation-repair` resume admission.
- Do not change `verifyDiffDerivedMutations` itself.

## Acceptance criteria

- [ ] `workflow-runner-resume.test.ts` `publication-time repair-introduced surviving mutation settles surviving_mutation_failed` drives an implement completion whose in-loop `verifyDiffDerivedMutations` seam returns `pass` and whose publication `readyFinalizer` seam returns `surviving-mutation`, then asserts `surviving_mutation_failed` with review `write.mutation-repair` resume admission; fails against the pre-fix publication-only first-discovery path that never ran in-loop verification.
- [ ] `workflow-runner-resume.test.ts` `publication-time repair-introduced surviving mutation does not reprompt implement` on the same seam setup asserts no `surviving_mutation_reprompt` log event and no implement write-loop re-entry after publication failure; only review `write.mutation-repair` admission is offered; fails against a pre-fix path that reprompted or re-entered implement at publication.

## Documentation updates

- Deferred to subspec 04.
