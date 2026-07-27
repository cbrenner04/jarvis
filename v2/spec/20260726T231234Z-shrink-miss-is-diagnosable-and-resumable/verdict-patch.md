Reviewing implementation and docs against the spec and advocate claims.


## Verdict — required outcomes

1. **`v2/docs/daemon-host.md` operator-error table**  
   The `contract_miss` row still documents `retryable: false` and `nextAction: inspect_spec` only. After this change, post-commit shrink (and any row whose terminal `loop_finished` has `loopOutcomeKind: "contract_miss"` and `resumable: true`, typically with `runStatus: "paused"`) must compose to `retryable: true` and `nextAction: "resume"`. The table must match `composeRunOperatorError` and the updated runbook/workflow-runner prose (same durable home as other list/wait error semantics).

2. **`RUN_OPERATOR_ERROR_RECOVERY.contract_miss` (and any linked refusal copy)**  
   Recovery text must not imply `inspect_spec` / re-run the spec as the only path when composition yields `nextAction: "resume"` (post-commit shrink miss). Align with `operator-runbook.md` and the daemon table so operators are not contradicted across surfaces.

3. **Guard-inversion acceptance criterion (subspec 01)**  
   The ticked AC requires inverting the **workflow-runner post-commit shrink resumability guard** such that `workflow-runner.test.ts` **`post-commit shrink contract_miss is resumable`** fails. A unit test on `isPostCommitShrinkResumableOutcome` alone does not satisfy that AC. The actuator must tie inversion to the seam that controls settle/resume (so the named integration test goes red when the guard is inverted) or the implementation does not meet the checked criterion.

4. **`contract_miss_detail` after reprompt (subspec 00 wire contract)**  
   Decisions require logging the **final** agent body used for contract evaluation after an in-iteration reprompt (same rule as `missing_blocker_detail`). Implementation uses `stepResponseTextForLog`, but tests only cover single-shot stdout. Add write-loop coverage that fails if reprompt-final text is not what gets logged (mirror the existing `missing_blocker_detail` reprompt pattern).

5. **Post-commit shrink settle and dual `loop_finished` (operator semantics)**  
   For post-commit shrink `contract_miss` and text-less `blocked`, the write loop still emits a non-resumable terminal `loop_finished`; workflow-runner settle moves the row to `paused` and appends a **second** `loop_finished` with `resumable: true` so `contract_miss` maps to `resume` instead of generic `resumable_pause`. That behavior is intentional but non-obvious and affects list/wait via last-terminal selection. **`v2/docs/workflow-runner.md`** (or the same durable home already updated for shrink recovery) must state that shrink rows can carry this corrective terminal event and that operator error uses the chronologically last terminal log record.

---

**Rationale (brief):** Items 1–2 are required doc alignment under `documentation-standard.md` for operator-facing semantics that changed. Item 3 matches an explicit checked subspec AC. Item 4 closes a gap between the pinned log wire contract and test coverage. Item 5 prevents maintainers from “fixing” dual terminals or first-`loop_finished` readers and breaking shrink-miss diagnosis/resume.

**Not required before merge (acknowledged, no actuator work unless you choose):** `blockerText` on `WriteLoopResult` vs artifact re-read for genuine shrink blockers; `contract_miss_detail` log persistence round-trip; workflow-entry vs `~shrink` row error projection; intent-level checkbox hygiene; harness `## Blocker` append on repeated shrink misses.