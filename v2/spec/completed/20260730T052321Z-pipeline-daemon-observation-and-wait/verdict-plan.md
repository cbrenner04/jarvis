# Adjudicator verdict

Required refinements before merge:

## 1. Pin the seven-state derivation precedence (subspec 00)

The spec names seven derived states but does not define the **ordered precedence walk** implementers must follow. Add an explicit derivation contract that covers:

- Check order among `interrupted`, `rejected`, `failed`, `running`, `awaiting-approval`, `pending`, and `succeeded` (including which signals beat which).
- **Approval stage satisfaction**: which raw stage statuses count as satisfied for the ordered walk (`succeeded` for workflow stages; `approved` for approval stages) versus undecided (`awaiting` → derived `awaiting-approval`) versus terminal (`rejected`).
- **Interruption source**: whether pipeline-row `status`, stage-row interruption, or both feed derived `interrupted`, and that recovered interruption is not treated as live work per intent.

**Rationale:** Intent forbids misclassifying undecided approvals, rejections, failures, and interruptions as live or successful. Subspec 01’s wait boundaries reuse the same derivation; without a pinned algorithm, snapshot and wait behavior can diverge and inversion tests cannot reliably guard correctness. Existing `derivePipelineState` is the template — the spec must own the expanded rules, not leave them to test archaeology.

## 2. State how `pipeline_wait` observes transitions (subspec 01)

The wait subspec defines *when* to return but not *how* the handler learns durable state changed. Commit to a concrete observation substrate aligned with intent (“no reconstructing from run rows; no implicit follow loop on snapshots”):

- Re-read durable pipeline/stage rows after in-process stage commits and/or on bounded polling until `AbortSignal`, using the **same derivation** as `pipeline_list`.

**Rationale:** Without this, implementers may reach for run-log follow or ad-hoc polling with no contract. The choice must be spec-visible and testable; bounded live-wait ACs depend on a defined wakeup path.

## 3. Align intent acceptance criteria with `pipeline_list` scope (intent)

Intent AC #1 bundles “unknown IDs refuse by name” into snapshot reporting, but `pipeline_list` is parameterless — there is no per-ID snapshot RPC. Narrow that criterion to list contents: every admitted pipeline with identity, derived state, and ordered stage fields; empty store returns empty `pipelines`. Keep named `unknown_pipeline` / `invalid_params` refusal under wait-only criteria (already in subspec 01).

**Rationale:** Intent ACs must match deliverable behavior. A wait-only error on a list-all RPC would force a non-existent API or a false passing criterion.

## 4. Document wait cancellation (subspec 01)

State that `pipeline_wait` honors `AbortSignal` (consistent with run `wait`), including that an aborted wait does not return a boundary result.

**Rationale:** Daemon wait handlers in this repo already expose cancellation; omitting it leaves operator/CLI integration ambiguous and untestable.

## 5. Clarify test fixture boundaries (subspec 00, optionally prerequisites)

State that coverage for `rejected`, `interrupted`, and approval-row vocabulary may **seed durable stage rows directly** in tests; runtime approval admission from a sibling spec is not a prerequisite for this slice.

**Rationale:** Prerequisites gate only on enumerated dependencies. Observation/wait must be implementable and verifiable before approval CLI/E2E land; row seeding is established repo practice for pipeline state tests.

---

**Not required:** Split subspec 00 — derivation, projection, and `pipeline_list` deliver one observable behavior and are not independently shippable under this intent. Concurrent waiters, `skipped`-stage explicit AC, millisecond timing budgets, and concurrent isolation tests remain optional polish consistent with repo deferral.