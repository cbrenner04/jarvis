# Adjudicator verdict — required spec refinements

## Upheld direction (no change)

Serial **00 → 01** on `invokeReviewRole` / settlement is correct. Problem statement, exclusions (caller abort, stall policy, profile ordering), and failing-test ACs for escalate-then-succeed and exhaust-then-name are sufficient in principle. Doc expansion beyond intent (`workflow-runner.md`, `v1-behaviors.md`, `daemon-host.md`) is acceptable for behavior-changing work.

---

## Required refinements

### 1. Subspec 00 — timeout escalation must not break quota fallback

**Outcome:** Decisions or tasks must state how wall-clock escalation composes with `executeWithQuotaFallback` so quota still walks the configured flat binding list in order within each escalation segment (not one binding per outer loop that severs quota’s chain).

**Also cover:** On role timeout during an in-flight quota walk, which binding is “current,” that history is preserved, and escalation resumes at the **next** binding in the full list without re-invoking bindings already consumed in that segment.

**Acceptance:** A preservation criterion anchored to existing or new tests: quota on an earlier binding still reaches a later binding and succeeds in one `invokeReviewRole` call, with no timeout involved (refactor-style citation per spec guidance).

**Rationale:** Without this, implementers can satisfy “retry next binding on timeout” and regress quota-only advancement—the core seam the intent fixes.

---

### 2. Subspec 00 — per-attempt timers and idle budget

**Outcome:** Document that each binding attempt gets a fresh `roleTimeoutMs` (worst-case wall time scales with rung count). State explicitly that idle-output / stall timing resets per binding attempt the same way, so a long hang on an early rung does not consume the next rung’s idle budget.

**Rationale:** Deliberate product behavior (N × bound) and a real foot-gun if idle is left implicit; operators need cost visibility in docs called out by 00/01.

---

### 3. Subspec 01 — contract for “names every exhausted rung”

**Outcome:** Decisions must fix the operator-visible contract: how agent + model for **each** timed-out rung appear (e.g. structured `bindingAttempts`, message text, or other persisted fields). Acceptance criteria must assert that contract, not an ambiguous “both rungs appear somewhere.”

**Rationale:** Current detail shape centers on the last binding; intent requires full attribution—tests need a single checkable shape.

---

### 4. Subspec 01 — end-to-end exhausted signal (producer, not only composer)

**Outcome:** At least one AC must prove the **production** path (e.g. `buildReviewInvocationFailureDetail` and/or workflow-runner persistence after full rung exhaustion) emits the exhausted-rung detail that `composeRunOperatorError` maps to `stop`. Hand-built detail in `run-operator-error.test.ts` alone is insufficient.

**Rationale:** Spec guidance requires observable behavior; composer-only tests can pass while the runner still emits last-rung-only detail.

---

### 5. Subspec 01 — single shared “terminal review timeout” rule for operator + workflow

**Outcome:** Tasks and ACs must tie **exhausted** wall-clock settlement to one rule used by both `composeRunOperatorError` (`nextAction: "stop"`, `retryable: false`) and post-commit / workflow retryability (`resumable` or equivalent), e.g. via shared helper or the same detail gate—not only `run-operator-error` while `isPostCommitReviewRetryableFailureKind` still treats all `timeout` as retryable.

**Rationale:** Intent forbids `retry_later` when rungs are exhausted; workflow `resumable: true` would contradict operator `stop`.

---

### 6. Intent and/or subspec 01 — clarify “retryable only while a further rung exists”

**Outcome:** Prose that after 00, further rungs are consumed **inside** `invokeReviewRole`; the workflow does not see a retryable wall-clock timeout with another configured rung left. Operator `retry_later` for review wall-clock applies only where the design still intends re-dispatch (non-exhausted paths), not terminal exhausted settle—which 01 pins to `stop`.

**Rationale:** Intent decision can be read as mid-chain operator mapping; the actual model is internal escalation then terminal non-retryable settle.

---

### 7. Subspec 01 — degenerate single-rung profile

**Outcome:** Exhausted settlement and `stop` / non-resumable behavior explicitly include a **single-binding** list (one timeout attempt, still names that rung, still not `retry_later`).

**Rationale:** Two-rung-only ACs allow a bogus “exhausted only when multiple attempts” guard.

---

### 8. Documentation — operator runbook vs snapshot continuation intent

**Outcome:** In `operator-runbook.md` updates (or intent out-of-scope / sequencing note), reconcile exhausted `role_timeout` (`stop`, re-dispatch does not fix deterministic overrun) with queued work on snapshot re-dispatch and binding re-resolve so operators do not get contradictory “retry role_timeout” guidance.

**Rationale:** Cross-intent doc conflict is a real merge risk; this spec owns exhausted wall-clock policy.

---

### 9. Subspec 01 — preservation AC style

**Outcome:** Preservation of existing mappings for `error`, `quota`, and `stall` should cite the existing parameterized or table tests in `run-operator-error.test.ts` (or equivalent anchor), not paraphrased behavior.

**Rationale:** Spec guidance: refactor/preservation ACs cite tests to avoid false preservation claims.

---

## Not required for verdict

- Further subspec split (scope fits two serial slices).
- Mandatory `review-cycle.test.ts` in 00 if 01 workflow-runner ACs cover settlement (optional belt-and-suspenders only).
- Staging path / timestamped `v2/spec` (commit-time convention).
- Meta guard-inversion AC verbosity (aligned with repo guidance).

---

## Summary

**Approve direction; require refinement before implementation.** Blockers are: **(1)** quota-safe escalation design + preservation test in 00, **(3–5)** explicit exhausted-rung detail contract and producer-to-`resumable`/`stop` alignment in 01, **(6–7)** intent clarity and single-rung case, **(2)(8)** operator cost and runbook cross-intent reconciliation. Smaller clarifications: per-rung idle reset (2), preservation test citation (9).