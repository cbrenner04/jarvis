## Verdict — `split-god-modules`

The plan split (subspec 03) is sound as written; no refinement required there. The patch split (00–02) needs the refinements below. All are refactor-only corrections that align the spec with the intent's own rule — *split along landed call seams, never separate a helper from its sole caller* — which three current helper assignments violate.

### Required refinements

1. **Pin the home of the shared types.** `PreflightOk`, `LoggingContext`, `IterationContext`, `IterationOutcome`, and `CompletionReadyGateResult` are currently defined in `run.ts` and consumed by functions slated for both `iteration.ts` and `completion-pipeline.ts`. No subspec states where they live after the split, which leaves an implementer to guess mid-migration. Add one decision: these types stay in `run.ts` and downstream modules import them type-only (so no runtime dependency edge is introduced and the value-dependency direction stays `run.ts → iteration.ts`). Place it where it governs the first extraction (00) or as a shared note covering 00–02. This is the only gap that could force an unguided decision during implementation.

2. **Remove `specOutsideWorktreeReadDirs` from subspec 00's re-export list.** Its only caller is internal and relocates into `preflight.ts` alongside it; no external consumer imports it. The current decision justifies the re-export with a false claim that external callers import it. It should move wholesale into `preflight.ts` with no re-export.

3. **Remove `mapExitCodeToReason` from subspec 01.** Both call sites are inside `runCommand`, which the spec deliberately keeps in `run.ts`. Assigning it to `completion-pipeline.ts` separates it from its sole caller and forces a permanent back-import. It stays in `run.ts`.

4. **Move `getSpecDisplayName` from subspec 01 to 02.** It is a logging/display utility called by `setupLogging` and `finalize`, both of which relocate to `iteration.ts` in 02. Keeping it in `completion-pipeline.ts` makes `iteration.ts` reach into the completion module for a generic helper. Reassign it to `iteration.ts`.

5. **Cover `generatePrBody` in subspec 01's acceptance criteria.** It is named as a top-level anchor for 01 but no criterion asserts it relocated. A primary anchor should be verifiable; add it to 01's acceptance list.

### Optional (low priority)

- The "shorter than before" / "substantially thinner" acceptance clauses add little beyond the adjacent "no longer defines X" structural criteria. Trimming them is harmless polish; not required.
- Subspec 01's "thin call chain" framing understates the transient import surface during the intermediate state (before 02 lands). Behaviorally moot; reword only if convenient.

### Rationale

Refinements 2–4 correct helper-to-module assignments that cut against the call seams the intent mandates, and each contradicts a decision the spec itself states ("don't split a helper from its sole caller"). Refinement 1 closes the spec's one genuine under-specification. Refinement 5 restores acceptance coverage for a named deliverable. None alter scope or behavior.