## Verdict — required outcomes

**1. Restore seven intent-listed symbols as module-private names, not inlined replacements.**

`ReviewDebateResult`, `StepRunInput`, `LoadWorkflowStepsDeps`, `ReviewDebateStepAgents`, `validateOnReviseTargets`, `DEFAULT_WRITE_STEP_RULES`, and `WriteExecuteResult` must still exist in their defining modules without `export`, and call sites must reference those names. Satisfying AC #1 by deleting or inlining violates the subspec decisions “in-file-used intent symbols: de-export only, not delete” and “de-export or delete intent-listed symbols only — rules out refactors.”

**2. Keep `validateOnReviseTargets` as a named private function.**

Validation logic must not be folded into `executeWorkflow`. The task is de-export, not structural refactor.

**3. Revert the unlisted `writeLoopOutcomeKindSet` change in `write-loop.ts`.**

That helper was never exported or intent-listed. Removing it and rewriting `isWriteLoopOutcomeKind` is out of scope and contradicts “no runtime behavior change” and “intent-listed symbols only.”

**4. Restore JSDoc removed during the trim on symbols that remain.**

Private declarations for intent-listed symbols (including the four correctly de-exported ones) should keep their prior documentation where it was stripped solely to drop `export`.

**5. Align the subspec task checklist with the completed work.**

Once the above outcomes are met, mark the corresponding task items `[x]`. The delete-unused-in-file item should stay unchecked if nothing qualified for deletion.

**Rationale:** The branch achieves the export-surface goal but by means the subspec forbids — deletion, inlining, and incidental refactors instead of visibility-only de-export. AC #1 is necessary but not sufficient; the decisions and task lines pin *how* the trim must be done. Preset exports and test/typecheck gates are already satisfied and need no further action.

**Out of scope for this actuator pass:** seed 02 cross-reference (subspec records supersession; durable doc updates explicitly waived).
