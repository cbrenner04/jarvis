# Adjudicator verdict — shrink-miss diagnosable and resumable

Required refinements before the spec is merge-ready:

## 1. Reconcile shrink text-less `blocked` (`missing_blocker`) with current behavior

The draft treats post-commit shrink text-less `blocked` as new resumability work, but write-loop and operator-error may already settle `missing_blocker` as resumable with `nextAction: "resume"`. A failing-test AC that passes on pre-fix code violates spec guidance.

**Outcome:** The spec must state whether subspec 01 changes shrink `missing_blocker` at the workflow-runner seam or only aligns `contract_miss` (and genuine shrink `blocked` terminal) with the existing shrink `invocation_failure` error path. If behavior is already correct, replace new-behavior ACs with explicit preservation or parity wording and drop claims that imply a net-new fix. If workflow-runner override is still required for uniformity with post-commit shrink, say so and keep a test that fails pre-fix.

## 2. Pin the `contract_miss_detail` contract

Decisions mirror other detail events but do not fix wire shape: field name, which invocation text is logged when reprompts exist, and union membership in persisted log types.

**Outcome:** Subspec 00 must record the observable log contract (event kind, fields, truncation rule, and which agent output is logged after reprompt resolution). Include an acceptance criterion that the typed log event surface includes `contract_miss_detail` with those fields, not only test assertions through the write loop.

## 3. Correct the harm narrative for resumability

“Recovery re-runs the whole implement write” overstates post-commit behavior; the real costs are non-retryable shrink on `contract_miss`, `committedResult` replay without a new shrink invocation, and `inspect_spec` guidance for shrink `contract_miss`.

**Outcome:** Intent and subspec 01 problem copy should describe operator-visible failure modes (blocked `~shrink`, no shrink retry, wrong next action) without implying implement is re-invoked when it is not. Verification may stay on double `executeWorkflow` if that matches repo precedent.

## 4. Bound resumability to post-commit shrink only

Decisions limit resumability to post-commit shrink outcomes; implement and pre-commit shrink `contract_miss` must stay as today.

**Outcome:** Subspec 01 must include automated guards that a broad workflow-runner change cannot regress: at least one negative case (e.g. pre-commit or non–post-commit shrink `contract_miss` remains non-resumable) and preservation that implement-step `contract_miss` classification is unchanged (cite an existing test or add one).

## 5. Assert full settle semantics for resumable shrink `contract_miss`

Draft ACs cover workflow `resumable` and `~shrink` row `paused`; daemon and operator-error also depend on loop-finished / store settle flags for `blocked` vs `paused` rows.

**Outcome:** Acceptance criteria must verify the same resumability signal the shrink `invocation_failure` error path already uses (e.g. `loop_finished.resumable` or equivalent on the shrink row), not only the workflow return object and run status.

## 6. Clarify preservation AC in subspec 00

The cited test guards loop result shape (`failureKind` absent), not absence of new log detail.

**Outcome:** Reword that AC so it cannot be read as “no `contract_miss` logging”; it should state loop result shape is unchanged.

## 7. Operator-error scope

`missing_blocker` may already map to resume; the gap for operators is shrink `contract_miss` → `inspect_spec`.

**Outcome:** Subspec 01 should state explicitly which outcomes get new operator-error composition. If only `contract_miss` changes, say so; avoid redundant ACs that only duplicate existing `missing_blocker` behavior unless 01 still changes that path.

## 8. Guard-inversion criterion

**Outcome:** Tie inversion to the predicate actually introduced in 01 (shared post-commit shrink resumability guard if both outcomes share it; single guard if `missing_blocker` is dropped from scope).

## 9. Prerequisites and doc ordering

Intent prerequisites (pre-shrink commit, existing shrink error resume) are absent from the staged index/subspecs. Runbook text in 01 references `contract_miss_detail` while logging ships in 00; index says 01 does not depend on 00 for code but docs can lie if 01 merges first.

**Outcome:** Copy prerequisites into `index.md` or subspec 01. Index or doc sections must make clear merge/order expectation: runbook shrink-miss diagnosis sentences depend on 00, or 01 defers those sentences until 00 lands.

## 10. Optional but recommended clarity (not blocking if omitted)

- Note that harness may still append `## Blocker` on `contract_miss` while detail events expose agent output (resume-at-shrink vs spec pollution)—runbook or decisions one-liner if operators will hit it.
- Task checklist in 01: do not change write-loop blocker detection (aligns with out-of-scope write-path `missing_blocker`).

---

**Rationale:** Items 1, 4, and 5 prevent false failing-test ACs and silent regressions. Items 2 and 6 make harness contracts implementable without wrong fixtures. Items 3, 7, 8, and 9 align prose, operator surfaces, and merge order with intent and spec guidance. Subspec split (00 / 01) and single-seam bundling in 01 remain acceptable; no split required.