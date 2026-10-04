Verifying the advocate's key findings against the implementation before issuing the verdict.
## Verdict

### 1. Typed run steering must work during pending pipeline admission

**Outcome:** While a detached `start` (or other admission) is in flight, typed `kill`, `pause`, and `resume-run` must still parse, run pre-RPC eligibility checks, and dispatch through `runSteeringAction` when eligible. They must not be dropped by the global `commandSubmissionBlockedByPendingAdmission` gate with no `lastCommandResult` and no RPC.

**Rationale:** `01-entry-dispatch` records an explicit decision that run steering is orthogonal to detached pipeline admission. The current `submitCommand` early return blocks these verbs entirely during `admissionPending`, which contradicts that decision.

**Proof:** Add a regression test that starts a pending admission, then submits a run-steering verb on an eligible selection and asserts the expected run RPC fires (and that ineligible submissions still get named `lastCommandResult` feedback rather than silent drops).

---

### 2. Typed run steering must not fall through to keybind’s silent `runId === null` path

**Outcome:** After the selection-shape guard passes, if the selected attributed run leaf cannot be resolved to a run id, typed `kill`, `pause`, and `resume-run` must set a stable `lastCommandResult` code and issue no RPC. They must not call `runSteeringAction` and rely on `runAction`’s silent return when `selectedRunIdFromState` is null.

**Rationale:** The subspec forbids reusing keybind `runAction`’s silent `runId === null` behavior on the typed path and requires pre-RPC refusal on `lastCommandResult` for ineligible dispatch. The ineligible-selection matrix covers the common refusal reasons but leaves this explicit contract unenforced once `run_leaf` passes.

**Proof:** Extend the ineligible-selection regression (or add a focused case) so that selection-shape success paired with an unresolvable run id produces named dock feedback and zero run RPCs for all three verbs.

---

### Not required for this pass

- Changing `kill`/`pause` ineligible fixture from `completed` to `killed` (behavioral contrast already exercised).
- Dedicated `actionableRunIds` typed-path test, shared kill-hint helper extraction, runbook Outcomes polish, or `intent.md` checkbox hygiene — reasonable follow-ups, not spec or AC blockers.
- Separate `@mutate` pin for `resume-run` eligibility; the ineligible matrix already contrasts `resume-run` success with `kill`/`pause` `not_live_run` on the same row.