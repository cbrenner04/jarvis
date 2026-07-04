Verdict: refine per the following.

**Uphold as required refinements:**

1. **Divergent resume steps array is unhandled.** Subspec 01 must state what happens if `executeWorkflow` is invoked on resume with a steps array that differs from the one the killed run used (different length, reordered, different stepIds). At minimum, add a decision: resume assumes the caller re-supplies the identical steps array; divergence is out of scope/undefined behavior for this spec.

2. **Attempt-history-follows-`run_id` should be stated, not left inferred.** Subspec 00 currently lets the reader guess how `step_id` on `runs` makes per-step attempt history queryable. Add an explicit decision/note: `attempts` keys off `run_id`; adding `step_id` to `runs` is sufficient for step-scoped attempt history, no `attempts` schema change needed. This resolves the ambiguity the intent's "or a new `steps` table" phrasing raises.

3. **Resume when no run row exists yet is not covered.** Subspec 01's resume algorithm ("first non-`completed` step") should explicitly state that a step with no run row yet counts as not-completed and is therefore a valid resume/start point — this is the common first-run case and shouldn't rely on inference.

4. **Duplicate `stepId` values across steps in one workflow are unaddressed.** Given the resume key is `(project, branch, step_id)`, two steps sharing a `stepId` would collide/merge attempt history silently. Add either a decision requiring `stepId` uniqueness within a steps array (with validation) or an explicit non-goal stating duplicate `stepId`s are caller error / undefined.

5. **Missing acceptance criterion for the soft-stop path.** Subspec 01 has an AC for hard-terminal outcomes (`blocked`/`contract_miss`/`invocation_failure`) halting the workflow, but decisions also assert soft-stops (`budget-exhausted`, `paused`) halt it — add a matching AC for at least one soft-stop case.

6. **Per-step `maxIterations` configurability is ambiguous.** "Each step inherits the existing per-step `maxIterations`/`signal`/`pauseSignal` semantics unchanged" doesn't say whether `maxIterations` can differ per step in the array. Add a decision stating whether it's per-step-configurable or a single value shared across all steps.

7. **Single-step-array equivalence and empty-array behavior are untested/undecided.** Add: an AC asserting a one-step array behaves identically to today's single-step invocation, and a decision covering empty-array input (reject vs. no-op).

**Low-cost clarifications worth folding in (not blocking, but should be explicit):**

8. Subspec 00 should add an AC (or note) confirming pre-migration NULL `step_id` rows resolve correctly post-migration — cheap given `write-loop.test.ts` already covers the no-`stepId` path, but currently left implicit.

9. Subspec 01 should state explicitly that `role` is not persisted in durable state — attempt history identifies steps, not the role/binding that ran — so a reader doesn't assume role provenance is captured given role→binding resolution is deferred.

**Rationale:** These gaps are all load-bearing per the spec-guidance ledger test — each names a plausible wrong behavior (silent collision, silent divergence handling, ambiguous per-step config) a competent implementer could otherwise pick differently, and each is cheap to pin now versus discovered at implementation or resume time. None require new scope beyond the two existing subspecs.