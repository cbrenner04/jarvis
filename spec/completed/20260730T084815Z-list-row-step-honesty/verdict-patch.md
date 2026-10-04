Validating the critical finding against the implementation before issuing the verdict.
# Verdict: required outcomes

## 1. Completed-rollup guard must use entry rollup, not the listed row’s status

**What must be true:** Workflow step snapshot projection applies the no-`pending` / `completedRollupStepWithoutRun` guard only when the **workflow entry row’s rollup** is `completed`, not when an individual list row’s own durable `status` is `completed`.

**Why:** Subspec 00 and `daemon-host.md` pin this rule to entry rollup `completed`. Today `buildRunListRow` passes `reportedStatus` into `workflowRowSnapshot`; for sibling step rows that value is the step’s own status (`completed` is common on a finished durable step). On an early-stop invocation (entry rollup `killed`/`failed`/`blocked`), a completed sibling can therefore mis-trigger the completed guard and mark never-run steps (including non-durable review and steps with no row) as `completed` instead of `pending`, violating the pinned early-stop contract and operator-visible list/TUI detail.

**Verification:** Add list or projection coverage where entry rollup is early-stop but a listed sibling row is `completed`; later unstarted steps must remain `pending`. Entry-row completed behavior must stay green.

---

## 2. Guard-inversion regressions must match ticked subspec 00 ACs

**What must be true:** The acceptance criteria that claim guard-inversion failures for (a) completed-rollup `pending` suppression and (b) settled review `attemptCount` are backed by tests that **fail when the guard logic is inverted**, in the same spirit as subspec 01’s `reconciledAt-only finish-time maximum guard inversion` test.

**Why:** Current `workflow-list-snapshot.test.ts` cases only assert happy paths (rollup `"completed"` → not `pending`; `attemptCount: 1` → `>= 1`). Ticked ACs overstate coverage; without inversion tests, a reverted guard can pass CI while breaking spec intent.

**Verification:** At least one test per claimed inversion AC that encodes the old/wrong behavior and proves it would fail under the correct implementation.

---

## 3. Freeze-path vs guard-backstop coverage must align with AC wording

**What must be true:** Tests and AC language distinguish two mechanisms subspec 00 defines:

- **Primary:** terminal review progress retained after live-map cleanup (production `clearLiveReviewProgress` strips only `in_progress`).
- **Backstop:** completed entry rollup with **no** progress for a step → suppress `pending` only; `role` / `terminalOutcome` / `attemptCount` may be hollow.

**Why:** Integration tests named “clears in-memory progress” exercise the primary retention path, not a fully empty progress map. Assertions on `role`, `terminalOutcome`, and `attemptCount >= 1` belong to the freeze path only. Either extend coverage with a backstop scenario (assertions scoped to non-`pending` / completed shape only) or narrow AC/test titles so they do not imply the backstop was exercised.

---

## 4. Align `intent.md` with subspec 00 scope

**What must be true:** `intent.md` decisions match subspec 00: no-`pending` applies to **completed entry rollup**, not every terminal rollup; early-stop later unstarted steps stay `pending`; settled `attemptCount >= 1` is for settled non-durable review, not live `in_progress`.

**Why:** Intent still states any terminal run must not report `pending` and uses `attempts` instead of `attemptCount`, which contradicts implemented decisions and risks future broadening.

---

## 5. Optional hardening (not blocking if explicitly deferred)

These are valid but low urgency relative to items 1–4:

- Floor settled `attemptCount` at projection as well as ingest (`>= 1` when terminal non-durable review progress exists).
- Use `invocationCount` without `Math.max(..., 1)` when zero roles actually started.
- Symmetric early-stop test with entry rollup `failed` (same branch as `killed`).
- Terminal progress map eviction / cross-restart honesty (explicitly out of scope per spec).

---

## Summary for actuator

**Must fix before treat-as-done:** (1) entry rollup wiring for completed guard + regression test; (2) guard-inversion tests for subspec 00 ACs; (3) reconcile freeze vs backstop in tests/AC wording; (4) align `intent.md`.

**Subspec 01 (`finishedAtMs` + `reconciledAt`):** implementation and docs are sufficient; no required actuator changes beyond any fallout from item 1’s list-row assembly.