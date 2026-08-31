Verifying the critical and high-severity findings in the implementation before issuing the verdict.
## Verdict: required outcomes before merge

### 1. Fix unscoped fan-out resume when a sibling branch is still `failed` (blocking)

**What must be true:** Unscoped or explicit-`default` `pipeline resume` on a fan-out pipeline where one branch has an unreopened `failed` row and another branch has a reachable `approved` gate plus undispatched pending workflow successor must not return `{ kind: "resumed" }` while failing to dispatch the approved lane’s successor, and must not scope continuation to the failed sibling’s `branchKey`.

**Why:** `resumePipeline` builds `reopenedStageReset` from the first matching `failed` row before admission chooses the approved-gate pending-strand path, then passes that reset into `continuePipeline`, which derives `effectiveContinuationBranchKey` from the failed row’s lane. That silently mis-scopes or no-ops dispatch — a false success. Subspec 01’s decision ledger rules out cross-lane dispatch and reopening unrelated failed stages; this shape was omitted from ACs but violates that intent.

**Acceptance:** Add regression coverage for this fan-out shape; unscoped resume either dispatches the approved lane’s successor correctly or refuses with a named reason — not `{ kind: "resumed" }` with no successor linkage.

---

### 2. Resolve unscoped resume under aggregate `running` (blocking)

**What must be true:** Behavior for unscoped/explicit-`default` resume when aggregate derived state is `running` but `resumeApprovedGatePendingStrandApplies` is true must match documented operator semantics. Today the approved-gate path runs before the `running` refusal check, so resume can dispatch while aggregate state is `running`.

**Why:** Subspec 01 explicitly blocked only aggregate `awaiting-approval` for unscoped recovery; it did not authorize a `running` exception. `pipeline-execution.md` still lists derived `running` under refused outcomes (aside from `resumeDrivesDeferredSettlement`). Code and docs conflict; operators cannot predict whether whole-pipeline resume advances a ready lane while another runs.

**Acceptance:** Either (a) refuse unscoped resume when aggregate derived state is `running`, matching the existing doc boundary and the `awaiting-approval` carve-out pattern, or (b) deliberately allow it and document that exception in every durable home that describes unscoped resume admission (`pipeline-execution.md`, `operator-runbook.md`, `daemon-host.md`, and the relevant `v1-behaviors.md` bullets). Pick one product policy; do not ship undocumented behavior.

---

### 3. Align RPC durable docs with implemented resume/approval semantics (required)

**What must be true:** `v2/docs/daemon-host.md` § Pipeline stage-scoped resume and the `resumePipeline` `branchKey` bullet in `v2/docs/v1-behaviors.md` must describe current behavior: approved-gate pending-strand admission on unscoped, explicit-`default`, and named-lane paths; branch admission that continues without `reopenFailedPipeline` on that strand; default-lane approval continuation without startup sweep; and whichever policy outcome from item 2 is chosen.

**Why:** Subspec doc ACs covered three homes; `documentation-standard.md` expects RPC durable homes to stay aligned. `daemon-host.md` still describes branch resume as failed-only with mandatory reopen, and the stale `v1-behaviors.md` branch bullet still lists only replayable `failed` as admissible.

---

### 4. Preserve what is already correct (no regression)

**What must stay true:** The landed fixes remain valid and must not regress:

- `branchKey: "default"` normalizes to unscoped continuation at `applyPipelineApprovalDecision`, `continuePipeline`, and `runPipeline`, so live approve dispatches the default-lane successor without restart.
- Linear and named-lane approved-gate pending-strand resume with sibling preservation.
- Unscoped resume refusal under aggregate `awaiting-approval` on mixed fan-out.
- Terminal and generic non-reopenable `pending`/`running`/`interrupted` refusals where unchanged by items 1–2.
- Existing subspec test coverage for the primary production shapes (default-lane approve linkage, linear resume, named-lane resume, mixed `awaiting-approval` negative).

---

### Not required for actuator action

- **`recoverContinuablePipelines` spy test:** Spec-mandated guardrail; weak as a regression against the original default-lane bug but fulfills subspec 00 AC intent.
- **Reachability / `reopenedFailurePermitsActivation` on the predicate:** Minor inconsistency for corrupted rows; address opportunistically when tightening item 1, not a separate blocker if item 1 is fixed correctly.
- **`intent.md` top-level AC checkboxes:** Harness-owned; subspec ACs are satisfied.
- **`normalizeContinuationBranchKey` exact-match only:** Pre-existing RPC contract; out of scope.

---

**Bottom line:** Merge is blocked until item 1 is fixed and tested, item 2 is resolved consistently in code and docs, and item 3 closes the `daemon-host.md` / `v1-behaviors.md` drift. The core production fixes (default-lane approve continuation; linear and named-lane pending-strand resume) are sound and should ship with those corrections.