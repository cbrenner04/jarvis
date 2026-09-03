Verifying key implementation claims against the spec and code before issuing the verdict.
## Verdict — required outcomes

### 1. Resume test inventory guard must match subspec 01’s per-source contract

**Issue:** `hasResumeModuleImport` zeroes buckets 2–4 at today’s merge-base, so the guard never inventories `workflow-runner-plan.test.ts` (`recoverPlanStage`), `recover-review-failed-plan-draft.test.ts`, or the publication bucket as subspec 01 specifies. Bucket 1’s full-file scan of merge-base `workflow-runner-resume.test.ts` still catches deletion of co-located cases today, but per-source provenance parity—the explicit subspec 01 decision and task checklist (“equal per-source case counts and unchanged leaf-title sets”)—is not enforced. The assertion also checks only `missing: []`, not that destination count equals expected count, so duplicate destination titles would pass.

**Required:** The inventory guard must either (a) enforce per-source bucket parity as written—scan each bucket without an import gate and/or pin merge-base to a ref that still reflects the pre-co-location layout—or (b) honestly narrow scope: drop or document inert buckets, state that bucket 1 is the operative guard post-co-location, and add symmetric count equality if bucket 1 remains sole guard. Header comment, `test-writing.md` bucket prose, and guard behavior must agree.

**Rationale:** Subspec 01 acceptance criteria were checked on a guard that does not deliver the documented four-bucket contract; silent test loss during future moves was the problem this subspec exists to prevent.

---

### 2. Resume dependency wiring must be documented and test-isolation-safe

**Issue:** Effectful resume entrypoints depend on `wireWorkflowRunnerResumeDeps` side-effect wiring from `workflow-runner.ts`. Production daemon paths load it via value imports; admission-only resume symbols do not need wiring. Consumers such as `pipeline-stage-recovery.test.ts` call `recoverPlanStage` while only type-importing `workflow-runner.ts`, so wiring depends on incidental module load order and can fail in isolated runs.

**Required:** `v2/docs/workflow-runner.md` module map must document the injection boundary: which resume symbols need wiring, that `workflow-runner.ts` (or an explicit test helper) must load first for effectful calls, and that admission resolvers do not. Every test or consumer that invokes effectful resume entrypoints must guarantee wiring without relying on another file having loaded `workflow-runner.ts` first.

**Rationale:** Subspec 03 required import-boundary documentation; subspec 00 chose injection over resume importing `workflow-runner.ts`. Undocumented load-order coupling is a latent flake and operator hazard.

---

### 3. Reconcile `intent.md` with completed subspecs

**Issue:** `index.md` and subspecs 00–04 are complete; `intent.md` top-level acceptance criteria remain unchecked and its decision ledger (“rules out retaining … near-budget monolith”) conflicts with subspec 02’s cost-gated split rule that landed.

**Required:** `intent.md` acceptance criteria and decision ledger must align with landed subspec outcomes (checked criteria where satisfied; ledger text consistent with cost-gated co-location).

**Rationale:** Internal spec-tree inconsistency misleads future implementers about what “done” means for this intent.

---

### 4. Clarify `test-writing.md` co-location prose

**Issue:** The 2026-08-25 paragraph conflates the historical concern-group `workflow-runner-resume.test.ts` (beside `workflow-runner.ts`) with post-extraction co-location beside production `workflow-runner-resume.ts`. Adjacent “each split file is well under the per-file health budget” reads as applying to the current single large co-located resume test file, which is intentionally unsplit until cost forces it.

**Required:** Prose must distinguish the two eras and state that the primary co-located resume test file may be large but remains unsplit until `bun run test:cost` exceeds the 150s / 120s thresholds.

**Rationale:** Subspec 04 landed placement docs; misleading operator guidance undermines the split-when-cost-exceeds rule the subspec documents.

---

### Not required in this pass

- Proactive split of the ~4k-line co-located resume test file (subspec 02 cost gate satisfied).
- Broadening the structure-guard regex (subspec 00 specified boundary).
- Full `v1-behaviors.md` sweep beyond the three symbols subspec 03 scoped (optional follow-on).
- Removing the inert `recover-review-failed-plan-draft.test.ts` inventory bucket (optional cleanup; parity lives in bucket 1 today).