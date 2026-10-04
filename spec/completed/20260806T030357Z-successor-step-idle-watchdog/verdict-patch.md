Verifying the advocate's key claims against the implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Close the actuator-only retry pre-arm gap (blocking)

**What must be true:** On `tryActuatorOnlyReviewDebateRetry`, the shell idle watchdog arms immediately after `iteration_started` and covers all work before the first `invokeReviewRole` call — including verdict I/O, binding resolution, and `profile.render.actuator`.

**Why:** Scope gate boundary #3 and subspec 01 pin this sequence: `iteration_started` → arm → first role. Today arming starts only after async prompt prep (~40 lines later). A stall in `profile.render.actuator` after `iteration_started` is exactly the pre-agent shell window this spec targets; it is unbounded and can wedge the branch claim.

---

### 2. Add actuator-only retry shell-stall coverage (blocking)

**What must be true:** `successor-step-idle-watchdog.test.ts` (or an equivalent harness at the same boundary) exercises `tryActuatorOnlyReviewDebateRetry` through `iteration_started` then silence with a short idle budget, and asserts terminal `role_stalled` settlement on the durable debate row.

**Why:** 00 names three dispatch boundaries sharing one mechanism; tests cover standard review and full debate only. Without retry-path coverage, the gap in #1 can regress unnoticed. A stall in `profile.render.actuator` is the natural repro once arming is moved.

---

### 3. Correct operator-facing docs for entry vs successor row (blocking)

**What must be true:** `v2/docs/operator-runbook.md` states that `role_stalled` / `retry_later` projection applies on the **durable successor row** (`review` / `review-debate`), or when `wait`/`list` targets that row’s `runId` — not unconditionally on the step-0 entry `runId`. Recovery guidance must say how to find the failed successor on a branch (e.g. list/filter by branch and `stepId`) rather than implying entry-level `error.reason: "role_stalled"`.

**Why:** Entry `wait`/`list` only adopts sibling errors for `surviving_mutation_failed` / `mutation_repair_exhausted`; post-commit `role_stalled` on a review sibling has never flowed through entry composition. Current runbook prose (“`run list` / `wait` report `error.reason: "role_stalled"`”) overclaims relative to implementation and existing daemon behavior (entry wait on sibling review failure yields `failed` rollup without successor error detail).

`daemon-host.md` is fine as written; only runbook entry-level wording needs tightening.

---

### 4. Fix daemon claim-release test projection assertion (blocking)

**What must be true:** In `daemon-workflow-start.test.ts` “terminal successor shell stall releases the branch claim”, claim release remains asserted via `check_workflow_start_claim` after terminal successor settlement. The entry-level `wait` assertion must not require `error.reason: "role_stalled"` on the step-0 `runId` unless entry composition is intentionally changed (out of spec scope). Assert `role_stalled` on the debate row directly, or drop the entry projection check.

**Why:** The claim-release AC is satisfied by the IPC probe; the entry `role_stalled` assertion conflicts with `workflowReviewMutationOwner` and weakens the test via a conditional guard. A false pass on projection would mask the doc overclaim in #3.

---

### Not required before merge

- **Orphan `stepPromise` on shell stall:** Acknowledged resource-leak risk; successor row is already terminal; not a spec AC miss for the primary repro.
- **`idleOutputMs: 0` tested only on review:** AC#5 requires one in-scope kind; semantics are centralized and unit-tested.
- **Duplicated arming (`runReviewDispatch` vs `raceStepSuccessorShellIdle`):** Maintenance concern; `@mutate` pin at review dispatch is satisfied.
- **`intent.md` drift:** Stale relative to scope gate; non-blocking for runtime correctness.
- **Entry-level `role_stalled` composition change:** Out of spec scope; docs should match current behavior, not expand composition.