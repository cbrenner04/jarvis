Verifying implementation and documentation against the spec before issuing the verdict.
## Verdict: required outcomes

### 1. Align stage-preservation and blocker-recycling docs with landed behavior

**What must be true:** Operator-facing docs must describe the same `preserveStage` predicate the code uses: a plan-draft redraft (and harness-blocker clearing on that redraft) is preserved when `.jarvis-plan-stage/index.md` exists **or** when `.jarvis-plan-stage/spec/` contains exactly one immediate child directory — not only when top-level `index.md` is present.

**Where:** `v2/docs/write-behavior.md` (Harness blocker clearing / recycling paragraphs) and `v2/docs/v1-behaviors.md` (plan-draft blocker routing bullet that still says preservation requires top-level `index.md`).

**Why:** Subspec 00 changed preservation so nested-only staging survives shape `contract_miss` redrafts; subspec 01 committed to aligning durable docs with that behavior. The shape-contract paragraph was updated, but preservation/recycling text still states the old top-level-only rule. That contradicts the implementation and the nested-only redraft test, and misleads operators about when harness diagnostics recycle vs when the stage is wiped.

---

### 2. Correct stale “effect-free” documentation for `checkStagedPlanDraft` and recovery revalidation

**What must be true:** Comments (and any related operator doc phrasing that implies read-only validation) must state that successful `checkStagedPlanDraft` / plan-stage recovery revalidation **resolves nested staging, flattens it to the staging root, and runs the contract normalizer** — mutating staged bytes on success, same as the write-step validation path.

**Where:** `checkStagedPlanDraft` export comment in `v2/src/execution/write.ts`; `revalidateStagedPlanContract` comment in `v2/src/execution/workflow-runner.ts` (currently labeled “Effect-free”).

**Why:** Recovery must accept operator-placed nested bytes the same way completion does; flatten-on-success is intentional wired behavior per subspec 00. Stale comments misrepresent side effects and could cause incorrect assumptions in future recovery or operator tooling work.

---

### 3. No code changes required for merge correctness

**What must be true:** Core resolve → validate → flatten → normalize wiring, ambiguous-`spec/` rejection, nested-only redraft preservation, flat landing parity, and `@mutate` guard proof meet subspec 00/01 intent. Orphan `spec/` when flat shape already passes, nested `intent.md` collision on flatten, redundant double-validation, missing flat+nested coexistence test, and durable-fallback behavior are acceptable as-is or out of this spec’s scope.

**Why:** Those items are either explicit spec decisions, bounded low-risk edge cases, or pre-existing behavior not scoped by the acceptance criteria.

---

**Summary:** Ship the implementation; the actuator must close the documentation gaps in outcomes 1 and 2 before treating operator-facing alignment complete. No further code or test work is required for correctness under this spec.