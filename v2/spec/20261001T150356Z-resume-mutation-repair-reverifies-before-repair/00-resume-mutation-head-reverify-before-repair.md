# Resume mutation HEAD re-verification before auto-derived repair

## Problem

`replayMutationFinalization` (`v2/src/execution/workflow-runner-resume.ts`) rebuilds repair input from the prior `loop_finished` via `survivingMutationErrorFromTerminalRecord` and calls `runAutoDerivedSurvivingMutationRepair` without diff-derived verification at HEAD. Reachable on main when `deps.mutationRepair` is omitted: `workflow-runner-resume-review-dispatch.test.ts` `"surviving_mutation_failed resume without explicit mutationRepair auto-derives write.mutation-repair before re-verification"` asserts repair runs before the ready-finalizer (mutation re-verification) tail. After the operator commits a killing test, repair can target an already-killed mutant and `settleMutationRepairExhausted` can carry the stale terminal-record survivor.

## Decision ledger

- In `replayMutationFinalization`, when `deps.mutationRepair` is omitted and the terminal record carries `surviving_mutation_failed` evidence, run diff-derived mutation verification at current HEAD (`context.worktreePath`, `context.baseRef`) before any auto-derived `write.mutation-repair`; rules out entering repair from `survivingMutationErrorFromTerminalRecord` alone.
- Clean HEAD verification (`kind: "pass"`) skips auto-derived repair and continues through `runReviewMutationCommitAndPublish` (publication tail including ready finalizer mutation re-verification); rules out spending repair budget when the worktree already kills the recorded site.
- HEAD verification `kind: "surviving-mutation"` maps to `SurvivingMutationError` with the same field contract as `runReadyFinalizer`'s default `runMutationVerification` closure in `write-loop.ts` (mutation, `sourceSite`, `killingTests`, `killingSetObservedResult`, `dualConstraint`); that error is passed to `runAutoDerivedSurvivingMutationRepair`; rules out repairing the terminal-record survivor when HEAD names a different site or metadata.
- HEAD verification `kind: "non-terminating-mutation"` maps to `NonTerminatingMutationError` like the same `runMutationVerification` closure and settles through the publication failure path that yields `non_terminating_mutation_failed` (same shape as `buildFinalizationErrorResponse` when the ready finalizer throws on mutation verify); rules out entering auto-derived repair, treating non-terminating as clean pass, or leaving the outcome to implementer choice.
- Terminal `loop_finished` `survivingMutation*` fields remain diagnostic for list/log projection only on this admission path; rules out using them as the repair target without a fresh HEAD verifier pass.
- `ReviewMutationResumeDeps.verifyDiffDerivedMutations` is the controllable HEAD verifier seam for unit tests; production defaults to `verifyDiffDerivedMutations` from `diff-derived-mutation-verifier.ts`; rules out ACs that depend only on real-git verification.
- `implement.recover` explicit `mutationRepair` deps and other `replayMutationFinalization` branches without terminal surviving-mutation evidence stay unchanged; rules out widening scope to in-flow publication repair or implement-row resume.

## Task checklist

- [ ] Add `verifyDiffDerivedMutations` to `ReviewMutationResumeDeps`; in `replayMutationFinalization`, gate auto-derived repair on HEAD verification via that seam (production default).
- [ ] Map verifier `surviving-mutation` / `non-terminating-mutation` outcomes using the `runReadyFinalizer` `runMutationVerification` field contract in `write-loop.ts` (extract shared helper only if duplication would fork site-picking).
- [ ] Add `workflow-runner-resume-review-dispatch.test.ts` regressions with injected `verifyDiffDerivedMutations` and update the existing auto-derive order test per acceptance criteria.
- [ ] Align `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` with HEAD-first resume repair admission (plain review resume, omitted `mutationRepair`).

## Acceptance criteria

- [ ] `workflow-runner-resume-review-dispatch.test.ts` `"surviving_mutation_failed resume with recorded survivor skips auto-derived repair when HEAD verification is clean"` — terminal `loop_finished` carries `survivingMutation` evidence; injected `deps.verifyDiffDerivedMutations` returns `kind: "pass"`; `mutationRepairBindingFactory` / repair invoke never run; `readyFinalizer` runs; fails against pre-fix `replayMutationFinalization`, which calls `runAutoDerivedSurvivingMutationRepair` from the terminal record without HEAD verification.
- [ ] `workflow-runner-resume-review-dispatch.test.ts` `"surviving_mutation_failed resume repairs HEAD survivor when it differs from terminal-record survivor"` — terminal record survivor A; injected HEAD verifier returns survivor B with distinct `killingTests` and `killingSetObservedResult`; repair prompt and exhausted repair terminal evidence name B's mutation/site and carry B's killing-set fields, not A's; fails against pre-fix path, which repairs stale A when HEAD would return B.
- [ ] `workflow-runner-resume-review-dispatch.test.ts` `"surviving_mutation_failed resume without explicit mutationRepair auto-derives write.mutation-repair before re-verification"` — renamed/updated so injected `deps.verifyDiffDerivedMutations` is invoked on the auto-derive admission path before repair invoke when HEAD still returns the same survivor A; ordered test events (or call counters) prove admission-path verify precedes repair and would fail if verification ran only inside `readyFinalizer`; survivor identity in repair prompt unchanged; fails against pre-fix order (`repair` before admission verify) documented in the problem section.
- [ ] `v2/docs/write-behavior.md` states plain review `surviving_mutation_failed` resume (no explicit `mutationRepair`) re-runs diff-derived mutation verification at HEAD before auto-derived repair, skips repair on clean HEAD, and repairs from HEAD verifier output not terminal-record fields alone.
- [ ] `v2/docs/operator-runbook.md` states that for plain review resume on `surviving_mutation_failed` (omitted `mutationRepair`), committing a killing test before `jarvis run resume` lets publication continue without entering mutation repair on a stale survivor.
- [ ] `v2/docs/v1-behaviors.md` records **[v2 behavior change]** review `surviving_mutation_failed` resume order: HEAD mutation re-verification before auto-derived repair; terminal survivor evidence is not repair input by itself.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — plain review `surviving_mutation_failed` resume re-runs diff-derived mutation verification at HEAD before auto-derived `write.mutation-repair`; clean HEAD skips repair; repair targets HEAD verifier output, not terminal-record survivor fields alone.
- `v2/docs/operator-runbook.md` — plain review resume on `surviving_mutation_failed` without explicit `mutationRepair`: committing a killing test (or otherwise clearing the mutant at HEAD) before `jarvis run resume` lets publication continue without entering mutation repair on a stale survivor.
- `v2/docs/v1-behaviors.md` — **[v2 behavior change]** review `surviving_mutation_failed` resume order: HEAD mutation re-verification before auto-derived repair; terminal survivor evidence is not the repair input by itself.
