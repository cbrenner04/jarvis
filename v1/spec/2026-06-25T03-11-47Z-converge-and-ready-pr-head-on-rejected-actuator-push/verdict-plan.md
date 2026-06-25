## Verdict — required refinements

### 1. Restate convergence eligibility in tree terms, not sha/ancestry terms

The spec’s “PR head equals the recorded gate-green head” and “sole divergence above the PR head” conditions are unsatisfiable or undefined under the motivating failure (non-ff rejection after remote advanced with a different commit but same tree, e.g. squash/rebase merge). Eligibility must be defined as: fetched PR-head tree matches local HEAD tree (the actuator tip), proving the failed actuator commit contributes no content the PR head lacks. Rules out sha-equality and linear “one commit above” framing.

### 2. Add an explicit non-convergence guard and AC for genuine actuator content

`git reset --hard` is only lossless when trees match. The spec must require: if local HEAD tree ≠ fetched PR-head tree, leave the worktree unchanged and surface the push failure. Add an acceptance criterion for that inverse — actuator carries net content not on the PR head → no reset, no auto-ready from convergence. Without this, convergence can silently drop real reviewer fixes and ready the wrong head.

### 3. Pin non-fast-forward classification as a documented decision

“Classify” is not independently verifiable. The spec must state how a push rejection is identified as non-fast-forward (stderr basis, distinct from the existing transient-retry path and from other permanent push errors). Aligns with repo norm for documented heuristics (cf. quota signals) and makes the “classified distinctly” AC testable.

### 4. Pin fetch-and-reset semantics and fetch-failure behavior

“Fetch + reset” must specify: fetch `origin/<branch>`, reset hard to that fetched tip (not a possibly stale tracking ref). On fetch failure: surface unchanged, no reset. Prevents converging to stale remote state.

### 5. Add observability for converge vs. surface

A harness-owned destructive reset needs operator-visible distinction between “converged to PR head” and “left diverged, surfaced failure.” Require a distinct fanout line and/or telemetry `exitReason` for the converge path — not reuse `actuator-commit-failed` for both outcomes.

### 6. Correct auto-ready mechanism prose; keep the behavioral AC

After reset to a PR head with a different sha than the recorded green carrier, `isTreeUnchangedSinceRecordedGreen` is false and auto-ready uses the **`full`** ready tier, not **`fast`**. The outcome AC (“exit `11` auto-ready readies the converged PR head”) remains valid; remove or correct task-checklist prose that claims fast-path readiness via sha match with the recorded green head. Spec guidance: ACs state outcomes, not mechanisms.

### 7. Make documentation updates falsifiable

Confirm what each cited doc actually says today before committing to amend it:
- `v1/docs/run-loop.md` exit-`11` row and review-incomplete auto-ready section — update to describe convergence + auto-ready, remove manual-finalize implication for this case.
- `v2/docs/v1-behaviors.md` review-incomplete auto-ready entry — same.
- `v1/docs/operator-runbook.md` — no dedicated rejected-actuator-push bullet exists under manual-finalize; either drop that doc AC or narrow it to amending the generic manual-finalize guidance / recovery message that still implies hand-finalize for this topology.

### 8. Revisit the deferred multi-commit note after #1–#2

The “stacked review-actuator commits” deferral inherits the broken “above the PR head” framing. Once eligibility is tree-based, restate what multi-commit divergence means (or defer with tree-language) so the deferral does not reintroduce sha/ancestry assumptions.

---

**Rationale (cross-cutting):** The intent — harness-owned recovery when the PR head already carries complete work — is sound and scoped correctly (converge in `review.ts`, reuse exit-`11` auto-ready). The blocking gap is the safety/eligibility invariant: sha and ancestry language cannot prove losslessness under the exact failure topology the intent cites. Tree-equality against a freshly fetched PR head is the minimum contract; classification, fetch, and observability gaps are load-bearing for a destructive reset path.
