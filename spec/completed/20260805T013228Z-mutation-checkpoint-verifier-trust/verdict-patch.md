Verifying the advocate's blocking claims against the implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Abort and timeout must not count as verified checkpoints (blocking)

**Required:** On the production default path, cooperative cancellation or per-directive wall-budget expiry during scoped verification must not classify the directive as `caught` or allow `spec.criteria-ticked` to pass on that basis.

**Why:** `defaultRunScopedTests` swallows subprocess failures and returns `false`; `applyAndClassify` treats that as a red suite and records `caught`. A cancelled or timed-out run is not falsification evidence. Subspec 02 requires terminate-and-restore on abnormal settle; the trust cluster exists so ticked mutation checkpoints cannot pass without a real scoped failure. The timeout regression currently expects `caught.length === 1`, which encodes the defect.

---

### 2. Abnormal settle must restore via snapshot on the production path (blocking, tied to #1)

**Required:** Abort, timeout, and throw during scoped verification must trigger pre-mutation snapshot restore on the default subprocess path—not only when tests inject a runner that rethrows.

**Why:** Subspec 02 and operator-runbook § Gate trust document snapshot restore on abnormal settle. Today snapshot restore runs only when `runScopedTests` throws; production abort/timeout does not throw, so restoration relies on per-directive `finally` for the active file only. Fixing #1 should make abnormal settle use the snapshot path consistently; until then, docs overstate the mechanism.

---

### 3. Stranded-mutation refusal must cover pending-commit resume (blocking)

**Required:** Before a completion commit finalizes— including when resuming from `jarvis-completion-pending.json`—the completion boundary must refuse if verify-run unrestored directives still appear as stranded replacement in the content that would be committed (staged tree and/or `HEAD`, per subspec 03).

**Why:** `refuseStrandedMutationsBeforeCommit` runs only in `preparePendingCommit`. The resume path loads a pending artifact and proceeds to `commit-tree` / `update-ref` without re-checking. Subspec 03 places the guard on the completion path after staging; resume bypass leaves a path where stranded mutations can ship after abnormal verification.

---

### 4. Align timeout regression with corrected abnormal-settle semantics (blocking, tied to #1)

**Required:** The `scoped verification timeout terminates and restores` test must assert that timeout does not produce successful checkpoint verification (`caught`), while still asserting subprocess termination and file restoration.

**Why:** Test currently expects `caught.length === 1`, matching the production bug. After #1, the regression must guard the intended behavior or it will re-allow the trust regression.

---

### 5. Reconcile `intent.md` with landed subspec decisions (non-blocking, doc-only)

**Required:** Update `intent.md` so it does not contradict shipped behavior: no 180s cap (subspec 02 uses remaining iteration wall only); pin-title mismatch is `hollow`, not `unresolved_pinning_test`; fixture references match the path-qualified pinning fixture.

**Why:** Subspec ACs are authoritative and met; `intent.md` is stale routing prose that will mislead future implementers.

---

### 6. Align `v2/docs/write-behavior.md` § `spec.criteria-ticked` (non-blocking, doc-only)

**Required:** Document mutation-checkpoint verification at the write contract boundary (narrowed selection, blocking unparseable/unresolved, abort/timeout, stranded-mutation refusal), consistent with `v1-behaviors.md` and operator-runbook.

**Why:** Per `v2/docs/documentation-standard.md`, durable behavior docs should match landed semantics. `write-behavior.md` still describes only the unticked-criteria gate.

---

### Not required before merge

- **180s per-directive cap:** Subspec 02 explicitly rejected inventing that constant; remaining wall budget is correct per landed spec.
- **Substring stranded-mutation matching:** Subspec 03’s verify-run-scoped replacement-present ∧ original-absent policy is intentional; false-positive tradeoff is accepted.
- **File-scoped unparseable blocking, comment-leading filter, directive-shaped criterion selection:** Normative subspec 00 decisions, implemented and tested.
- **Corrupt/missing unrestored persistence fail-closed:** Valid hardening follow-up; semantic verify-run scope is otherwise met.
- **`throwIfAborted` → unclassified throw:** Acceptable when the write iteration is already aborting; no false `complete`.
- **Missing pin for subprocess signal/kill:** Reasonable follow-up after #1; subspec 02 ACs target verifier behavior, not `shared/subprocess.ts` unit tests.

---

**Actuator priority:** Fix **#1, #2, #3, #4** before merge. **#5–#6** are doc reconciliation that can land in the same pass but do not block behavioral correctness.