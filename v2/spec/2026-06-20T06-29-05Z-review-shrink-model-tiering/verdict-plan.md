## Verdict — Refinements Required

The spec is accurate and correctly scoped (the tiering knobs genuinely already exist; this is rightly a docs-only change). But it is under-decided: it silently drops an intent requirement and omits the one non-obvious gotcha that operator guidance exists to surface. The following refinements are required before merge.

**1. Restore the "recommended models" requirement (must).**
The intent asks to document *recommended faster models* for the read-only review roles vs the implementation/shrink actuator. The spec only says "assign faster models" abstractly — no concrete tier named. Either name illustrative tiers (e.g. a fast/cheap reviewer tier vs an implementation-grade actuator tier) in the guidance, or record an explicit decision that the guidance stays model-agnostic because model IDs churn. Dropping an intent requirement without either satisfying it or recording the choice violates the ledger discipline this repo requires. Concrete guidance with at least an illustrative tier is preferred, since "faster models" with no example is nearly contentless.

**2. Document the cross-mode coupling of `modes.review.agentOrder` (must).**
The same review agent-order knob drives reviewers in *both* plan-mode self-review and patch-mode review (one shared resolution path). An operator setting fast models to speed up patch review simultaneously retunes plan-mode self-review. This is the single non-obvious behavior of the knob and exactly what guidance should warn about. Add a decision capturing the coupling and an acceptance criterion that the `agents.md` guidance states it.

**3. Reframe the `v1-behaviors.md` entry as a positive behavior (should).**
The catalog records what v1 *does*; "we added prose, no new logic" is the absence of a behavior. Record the actual order-resolution mapping instead — read-only review roles resolve `modes.review.agentOrder` falling back to `modes.plan.agentOrder`; review actuator and shrink actuator resolve `modes.patch.agentOrder` — and note the tiering as operator guidance layered over that existing resolution. This satisfies the intent's "config-only note" while keeping the catalog truthful.

**4. Qualify the cost/quality tradeoff (should).**
The guidance frames faster reviewer models as cost/latency-only. Reviewers produce the verdict the actuator acts on, so weaker reviewer models trade defect-catch quality for speed. Add a one-line caveat so the guidance is honest about the tradeoff.

**5. Make the unset-default fact actionable (should).**
The spec states the fallback fact but doesn't translate it into the practical takeaway: `modes.review.agentOrder` only needs setting if the plan order is expensive — a cheap `modes.plan.agentOrder` already yields tiered reviewers for free. Fold this into the guidance.

**Operator sign-off (not a spec edit).**
The intent was authored believing the config knob was missing ("add a config field"); the spec correctly collapses this to "document an existing field." The spec already surfaces this prominently (the "What already exists" section and Decision 1), so no further spec text is needed — but the reframe should get an explicit operator yes before merge.

**No action.**
The `typecheck`/`test` gate grading nothing (zero code change) is harmless house-convention boilerplate; keep it. The "documents that…" soft-criteria concern is resolved as a side effect of refinements 1–2 pinning checkable artifacts.