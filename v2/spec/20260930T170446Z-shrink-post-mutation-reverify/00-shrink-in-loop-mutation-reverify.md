# Shrink in-loop diff-derived mutation re-verification

## Problem

`implement.prompt.shrink` iterations commit through the write loop with no call to `verifyDiffDerivedMutations`. A shrink pass that deletes or reshapes code so a changed guard loses killing coverage still settles `loopOutcomeKind: "complete"` on the hidden `~shrink` row; publication's confirm-only pass then settles terminal `surviving_mutation_failed` with no `surviving_mutation_reprompt` on that row (reachable on main via shrink row `74c6fa62` / publication row `b1cbb5ba` in seed `v2/spec/seeds/shrink-preserves-mutation-coverage.md`).

## Decision ledger

- After each shrink iteration that settles `complete` (including `no-work`), invoke the same `verifyDiffDerivedMutations` seam and `runBase: args.worktree.baseRef` used for `implement.prompt.body` in-loop discovery in `write-loop.ts`; rules out publication-only discovery or a different diff base for shrink.
- Reuse the existing in-loop implement branch for `surviving-mutation` and `non-terminating-mutation` outcomes (checkpoint, `surviving_mutation_reprompt` + `write.surviving-mutation-reprompt`, or terminal `surviving_mutation_failed` / `non_terminating_mutation_failed` on budget exhaustion), not v1 patch shrink's `revertAllSince(preShrinkHead)` as the sole enforcement; rules out treating shrink survivors as publication-only failures with no shrink-row reprompt.
- Gate the new call on shrink write loops only (`promptId === "implement.prompt.shrink"` or `bindingResolution?.role === "shrink"`), still before the per-iteration checkpoint; rules out running coverage advisory or this verifier on unrelated prompts.
- Do not run the coverage advisory on shrink completions; rules out extending the implement-only advisory block to shrink.
- Record pre-shrink HEAD (implement's verified tree) when the shrink row starts. If the shrink row's surviving-mutation reprompt budget exhausts, reset the worktree to pre-shrink HEAD (drop shrink commits, discard uncommitted edits) and settle the shrink row `complete` so publication proceeds on the verified tree; rules out a terminal `surviving_mutation_failed` caused solely by an optional shrink pass (rows `74c6fa62` deleted `work-boundary-telemetry.test.ts`, `2cb0de7d` rewrote `diff-scan.ts`).
- File ownership vs sibling lanes: this spec owns the in-loop completion verification branch in `write-loop.ts` and `runShrinkAfterImplementComplete` in `workflow-runner.ts`. `publication-inflow-mutation-repair` owns `publishWithReadyRepair` survivor dispatch, the shared mutation-repair driver, and `workflow-runner.ts` completion-publication tails; `mutation-reprompt-colocated-fix-line` owns reprompt/repair `promptPlaceholders`. Do not edit those regions; rebase onto whichever lands first.

## Task checklist

- Extend `write-loop.ts` so shrink completions enter the same diff-derived mutation verification path as `implement.prompt.body` (extract a shared predicate/helper if that keeps one settlement branch).
- Add `write-loop.test.ts` coverage that drives `implement.prompt.shrink` (or `bindingResolution.role: "shrink"`) through a `done` iteration where the injected verifier returns `surviving-mutation` after a co-located killing test would be gone, asserting `surviving_mutation_reprompt` and that the shrink loop does not append terminal `loop_finished` with `loopOutcomeKind: "complete"` until verification passes (mirror the existing implement-complete reprompt test shape).
- Update `v2/docs/write-behavior.md` § Diff-derived mutation verification so in-loop discovery explicitly includes post-completion shrink iterations and publication confirm-only semantics stay unchanged.
- Add a `v2/docs/v1-behaviors.md` **[v2 behavior change]** entry: shrink completion may reprompt or settle terminal mutation failure in-loop instead of deferring entirely to publication `surviving_mutation_failed`.

## Acceptance criteria

- [x] `write-loop.test.ts` adds a shrink-loop case: after shrink settles `done`/`no-work` with a co-located killing test removed from coverage, run telemetry includes `surviving_mutation_reprompt` and the shrink row does not finish toward publication with terminal `loop_finished` `loopOutcomeKind: "complete"` until verification passes; fails against the pre-fix shrink-complete path.
- [x] Shrink-row exhaustion case (`write-loop.test.ts` or `workflow-runner-review.test.ts`): shrink commits a change that deletes the co-located killing test and every reprompt leaves the survivor; after the shrink row settles, worktree HEAD equals the recorded pre-shrink sha, `git status --porcelain` is empty, the shrink row is `complete`, and no terminal `surviving_mutation_failed` is appended; fails against the pre-fix path (shrink commit kept, publication fails).
- [x] `write-loop.test.ts` `"implement complete surviving mutation reprompts before publication"` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — document shrink post-iteration mutation re-verification beside implement in-loop discovery; keep publication confirm-only wording aligned.
- `v2/docs/v1-behaviors.md` — catalog shrink in-loop mutation reprompt/terminal settlement vs publication-only failure.
