Verifying implementation and documentation against the completed subspec before issuing the verdict.
## Verdict: required outcomes

### Ship as-is (behavior)

The production fix matches the completed subspec: `checkEligibility` blocks on `!isTerminalRunStatus`, boundary-terminal helper and its other callers are untouched, daemon `isLive` stays independent, abandon still refuses a live `.jarvis.lock`, and required tests/AC for the status matrix, daemon-with-terminal-durable-rows, abandon lock, and gh fail-closed are satisfied. **No code changes are required for the eligibility predicate or abandon lock behavior.**

---

### 1. Reconcile `intent.md` with the shipped contract

**Outcome:** `v2/spec/.../intent.md` must not contradict the completed subspec, JSDoc, or operator runbook.

- **Lock:** “Still refuse” must apply to **`runAbandonCommand` / `isWorktreeLiveHeld`**, not to bulk merged-worktree retirement via `checkEligibility`.
- **Store errors:** Document **`listRuns()` throw → propagates; cleanup aborts** — not the same as gh/daemon marking a worktree ineligible.
- **Acceptance criteria:** Reflect completed behavior (including lock scoped to abandon, store propagation); decisions aligned with subspec **Decisions**.

**Rationale:** Intent is the durable acceptance contract per documentation standard; leaving unchecked ACs and wrong fail-closed/lock wording will misread the gate and invite regressions (e.g. swallowing store errors into ineligible).

---

### 2. Runbook: bulk eligibility vs `.jarvis.lock`

**Outcome:** In `v2/docs/operator-runbook.md` § **Cleanup: eligibility gate**, operators must see that **default bulk retirement does not read `.jarvis.lock`**; live lock still blocks **`jarvis cleanup --abandon`** (as in the existing abandon section).

**Rationale:** Subspec explicitly keeps lock out of `checkEligibility`; runbook today documents lock on abandon but not the bulk negative, which reads like lock always blocks retirement.

---

### 3. Rename the store-error preservation test

**Outcome:** The test currently titled **`returns ineligible if store throws`** must be named (and grouped if needed) so it clearly asserts **error propagation**, consistent with subspec decisions, AC text (“propagate; fail-closed via abort”), and test body comments.

**Rationale:** A misleading title is a maintenance hazard against an explicit “do not swallow into ineligible” decision.

---

### 4. Subspec task checkboxes (when touching the spec tree for item 1)

**Outcome:** In `00-eligibility-gate-terminal-durable-runs.md`, **Tasks** checkboxes should match completed work (all `[x]`), same as **Acceptance criteria**.

**Rationale:** Cosmetic only; avoids implying incomplete implementation after intent alignment.

---

### Not required in this actuator pass

- End-to-end `runCleanupCommand` with reconciled `killed`, bulk “proceeds despite live lock” test, daemon-vs-abandon fail-closed behavior changes, or `.find` callback rename — out of subspec AC or pre-existing surface.
- **`v1-behaviors.md`:** Current bullet states the rule via `!isTerminalRunStatus`; naming **`TERMINAL_RUN_STATUSES`** explicitly (as in runbook/subspec doc task) is optional polish, not a behavioral gap.