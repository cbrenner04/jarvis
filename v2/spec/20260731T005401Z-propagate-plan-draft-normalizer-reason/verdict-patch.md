Reviewing the implementation against the spec and advocate response to issue a verdict.
# Verdict: required outcomes

## 1. Prove staging normalizer failure cannot pass on durable fallback

**Outcome:** A `write.test.ts` regression must exercise a plan-draft tree where staging (`.jarvis-plan-stage`) is shape-valid but fails normalization, while the durable `specPath` tree would pass validation. The settled result must be `contract_miss` (not `complete`) with `failedContractId` `"artifact.exists"` and `failureReason` carrying the **staging** normalizer message—not `plan.draft.shape`, not durable-only success.

**Rationale:** Subspec 01 explicitly requires that when staging fails normalization but durable would pass, the contract still fails with the staging normalizer reason. `composePlanDraftArtifactCheck` implements this via an early return on non-shape staging failures, but no fixture covers both legs. This was the core motivation for replacing the `||` chain; without a test, a durable-fallback false-pass can regress silently.

---

## 2. Bind `contract_miss_detail.failureReason` to step `failureReason`

**Outcome:** The `write-loop.test.ts` plan-draft normalizer log-detail test must assert that `contract_miss_detail.failureReason` **equals** the write-step `failureReason`, not merely that it contains normalizer substrings.

**Rationale:** Subspec 02 acceptance criteria require the log field to **match** step `failureReason`. The current test only checks substring containment, so the AC is ticked without the binding it describes. `WriteLoopResult` omitting `failureReason` is deferred for run-row projection; that deferral does not relax this AC. Use a test seam, captured step result, or another mechanism that proves equality on the loop path.

---

## 3. Isolate write-loop invert-test global state

**Outcome:** `setInvertContractMissDetailFailureReasonForTest` must be reset reliably after the invert-guard test (e.g. `afterEach` or `try/finally`), matching the hygiene in `write.test.ts`.

**Rationale:** Resetting only at the end of the test body leaks global state if the test throws mid-run, risking order-dependent failures in later tests.

---

## Not required

- **Step-runner invert hook:** Subspec 00’s invert-guard AC is satisfied by the dynamic-reason test’s assertion against static `contract.reason`; a dedicated `setInvert*ForTest` hook is optional consistency, not a blocker.
- **Durable-only normalizer message when staging fails shape-only:** Spec-intentional (staging `reason` wins on double failure); no change required.
- **`plan.draft.blocker` blocker path, run-row `failureReason`, log truncation, cross-boundary fixtures, duplicate index test, doc wording reorder:** Out of scope, deferred, or cosmetic follow-up.
- **`intent.md` open checkboxes:** Process housekeeping for spec close; not an implementation defect.