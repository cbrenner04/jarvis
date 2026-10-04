Verifying operator-facing doc drift the advocate flagged.
## Verdict — required outcomes

### 1. Align `v2/docs/first-workflow-walkthrough.md` with shipped plan (and shared review) defaults

The runbook points operators at this walkthrough for the happy path. It still says `--review-passes` defaults to zero for intent and plan, titles the plan section as light-review-by-default, and claims `--review-passes 0` matches bare `plan`. After this change, bare `plan` runs one debate review; only explicit `--review-passes 0` is draft-only.

**Outcome:** Plan (and the shared “defaults to builder” copy that still groups intent with plan) must state omitted passes as one debate pass for `plan`, document `--review-passes 0` as the draft-only opt-out, and use examples that match debate-default `plan` and light via `plan-reviewed-light` or `--review-behavior light`. Remove any claim that zero passes and bare `plan` are equivalent.

**Rationale:** Operator-facing semantics changed; `documentation-standard.md` places workflow/operator behavior in `v2/docs/`; the subspec task checklist calls for cross-section consistency; leaving the walkthrough wrong contradicts updated runbook and `workflow-runner.md`.

### 2. Remove contradictory `plan-reviewed` guidance in `v2/docs/workflow-runner.md`

The plan section correctly treats `plan-reviewed` as behaviorally redundant with `plan`, but still tells operators to choose `plan-reviewed` for adversarial review.

**Outcome:** Guidance must reflect that bare `plan` already defaults to one debate pass; `plan-reviewed` is migration-only redundancy; lighter review is `plan-reviewed-light` or `plan` with `--review-behavior light` (and flags as needed). No instruction that implies `plan-reviewed` is the debate entry point.

**Rationale:** Matches acceptance criteria to eliminate draft-only `plan` vs distinct `plan-reviewed` contradictions and the spec decision that bare `plan` matches former `plan-reviewed`.

---

### No required code or test changes

`reviewPasses ?? 1`, explicit `0` draft-only, `reviewBehavior ?? "debate"`, `buildReviewedPlanWorkflowSteps` as identity delegate, light wrapper behavior-only default, listed durable docs, composition tests, and the default-on landing regression test satisfy the written acceptance criteria. CLI alias injection vs registry builders, loaded-step shape vs `reviewBehavior` field on steps, landing test scope (git-disabled, no duplicate verdict assertion), and generic legacy deprecation stderr are acceptable as-is or out of this subspec’s scope.

### Optional (not blocking)

- Tighten preset-surface alias bullet so readers do not infer bare `plan` defaults to light.
- Soften `plan-reviewed` deprecation hint toward bare `plan` (same class as `intent-reviewed` polish).