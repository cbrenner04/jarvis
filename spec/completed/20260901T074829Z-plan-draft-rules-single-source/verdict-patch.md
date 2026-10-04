Reviewing implementation against the completed subspec and documentation to issue a verdict.
## Verdict

### Required outcomes

1. **`v2/docs/v1-behaviors.md` behavioral-AC catalog entry (~line 206) must not imply `plan.prompt.draft` Rules enforce behavioral acceptance criteria.** The entry was revised to attribute *Sources* to injected `SPEC_GUIDANCE`, but the body still groups `plan.prompt.draft` with review prompts as joint enforcers. After this change, draft Rules carry step mechanics only; behavioral AC norms reach the draft agent solely via injected `SPEC_GUIDANCE`. Review roles (`plan.prompt.review.adversary`, `plan.prompt.review-actuator`) still carry verdict/review Rules beyond injection. The failing-test entry on the next line already uses the correct pattern (“Injected `SPEC_GUIDANCE` enforces this rule”); the behavioral-AC entry should match that ownership split so operators and future editors do not treat `prompts/plan/draft.md` Rules as the normative home for behavioral AC policy.

### Rationale

The subspec’s doc task scoped lines 205–207 to attribute enforcement to injected `SPEC_GUIDANCE` rather than duplicate `prompts/plan/draft.md` Rules bullets. Sources footnotes were updated; the behavioral-AC body prose still blurs the split the spec established. That is the one documentation gap within spec scope that remains after an otherwise complete implementation.

### No action required

- **Draft dedup, occurrence pins, and absence of the draft paraphrase** — implemented and covered by `shared/prompts/plan-draft.test.ts` and updated v1 prompt tests.
- **Review-actuator `Rewrite structural **product**` preserved once** — matches the subspec decision ledger; review-actuator behavioral-AC dedup and `when structure is the contract` single-occurrence pins were explicitly ruled out.
- **Minimal vs production-shaped draft assembly** — AC pins contract phrases on `buildPlanDraftPrompt` with real `readSpecGuidance()`; duplicates lived in template Rules, not suffix sections.
- **Line 208 guard-contract attribution** — outside the subspec’s named doc entries; stale but not in scope.
- **Failing-test normative wording shift** — agent-core is authoritative per the decision ledger; v1 tests pin the shift.
- **Snapshot fixtures with placeholder guidance** — correct layer separation; dedup regression belongs in shared render tests with real guidance.