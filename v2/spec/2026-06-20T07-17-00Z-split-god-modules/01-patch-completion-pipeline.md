# Extract patch completion pipeline

## Problem

The completion seam in `v1/src/modes/patch/run.ts` — spec-done detection, the completion ready gate, PR body generation, and exit-reason mapping — is mixed into the same file as the iteration loop. It is invoked from the iteration loop and is cleanly separable.

## Decisions

- Move the completion seam to a new `v1/src/modes/patch/completion-pipeline.ts`; co-locate its private helpers. Rules out leaving completion logic in `run.ts` once iteration is later extracted.
- Anchor functions to relocate: `tryFinishSpecIfDone`, `runCompletionReadyGate`, `generatePrBody`, plus supporting helpers (`normalizeReadyFailureText`, `isReadyFailureUnchanged`, `diffAcceptanceCriteria`, `getIndexTitle`, `getCurrentBranch`, `lookupPrUrl`). Rules out splitting a helper from its sole caller.
- `mapExitCodeToReason` stays in `run.ts`: both call sites are inside `runCommand`, which 02 keeps in `run.ts`. Rules out separating it from its sole caller and forcing a back-import.
- `getSpecDisplayName` is not moved here; it is a display helper for `setupLogging`/`finalize` and relocates to `iteration.ts` in 02. Rules out `iteration.ts` reaching into the completion module for a generic helper.
- The still-in-`run.ts` `runIteration` calls the completion pipeline via import from the new module. Rules out duplicating the call chain.
- Sequenced after subspec 00 and before 02 (iteration imports this module). Rules out an ordering that leaves `iteration.ts` importing a not-yet-extracted seam.
- Refactor-only: relocation + import wiring, no logic edits.

## Task checklist

- [ ] Create `completion-pipeline.ts` with the completion seam and its private helpers.
- [ ] Rewire `run.ts` (`runIteration`) to import from `completion-pipeline.ts`.
- [ ] `bun run typecheck`; `bun run test`.

## Acceptance criteria

- [ ] `v1/src/modes/patch/completion-pipeline.ts` exists and defines `tryFinishSpecIfDone`, `runCompletionReadyGate`, and `generatePrBody`.
- [ ] `v1/src/modes/patch/run.ts` no longer defines those functions and is shorter than before the change.
- [ ] No `v1/test` behavioral assertions change (import-path edits only, if any).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- None. Internal-only relocation; no operator-facing or behavioral change, so `v2/docs/v1-behaviors.md` is unchanged.
