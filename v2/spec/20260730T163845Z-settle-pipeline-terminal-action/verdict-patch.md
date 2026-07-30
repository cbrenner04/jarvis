Verifying key implementation claims against the code before issuing the verdict.
## Verdict: required outcomes

### 1. Settlement must always reach a durable terminal outcome after executor success or failure

When `executeTerminalPublication` completes (success or normalized failure), the pipeline must not remain in settling `running` with all stages `succeeded` and no `terminal_publication_succeeded_at` or `terminal_publication_failure`.

Today, a throw from `commitTerminalPublicationSuccess` (or an unhandled throw from failure commits) escapes `settlePipelineTerminalPublication` into `runPipeline`'s outer `catch`, which only fails `pending`/`running` stage rows. With every stage already `succeeded`, nothing is recorded and derived state stays `running` forever.

**Why:** Violates the spec decisions that pipeline success requires terminal-action success, settling `running` is transient, and failures are durably recorded on the pipeline row.

---

### 2. `commitTerminalPublicationFailure` and `commitTerminalPublicationSuccess` must have store-level tests

The task checklist requires atomic commit APIs on `StateStore`. Implementation exists; `state-store.test.ts` has no coverage of first-write behavior, mutual exclusion between failure and success markers, or idempotent no-op when a marker is already present.

**Why:** These commits are the durability boundary for settlement; untested conditional UPDATEs are a regression risk for the core contract.

---

### 3. `leave-draft` completion skip must be proven, not only wired

`pipeline-stage-resolve.ts` sets `skipReadyFinalization` and `publishCompletionArtifacts` honors it, but no test asserts that `runReadyFinalizer` is skipped for `leave-draft` pipeline implement completion. AC1 exercises only the terminal seam (no-op executor), so production could still flip draft during completion while all acceptance criteria pass.

**Why:** Spec decision and task checklist own completion↔terminal composition for `leave-draft`; wiring without proof leaves the verdict-plan blocking gap unresolved.

---

### 4. `daemon-host.md` must document pending-settlement continuation in `isPipelineContinuable`

Code treats `isPipelineSettlementPending` as continuable regardless of derived `pending`. The restart-reconciliation section still describes continuable purely as derived `pending` plus approval/reopen guards. Derivation documents settlement recovery; the continuable composition paragraph does not.

**Why:** Required documentation update for restart recovery; stale text misleads operators about how crash/restart finishes never-attempted settlement.

---

### 5. `derivePipelineState` JSDoc must match the documented precedence

The function JSDoc still ends at stage-walk predicates and `succeeded`; it omits settling `running` and terminal-publication `failed`. `daemon-host.md` is current; inline contract is not.

**Why:** Precedence changed in this slice; the JSDoc is the symbol-level contract for a non-obvious ordering rule.

---

### Not required for actuator action

- **`pipeline_wait` event latency:** Polling fallback for non-`updateStage` writers is established observation policy; correctness holds within one poll interval. Optional doc sentence only.
- **Concurrent double settlement:** Single-owner model and idempotent markers make this out of scope; no action.
- **AC2 inversion scope:** AC names `hasPipelineTerminalPublicationFailure` inversion; adding `derivePipelineState` assertion is optional hardening.
- **AC3 counter naming / multi-stage input proof / resume-refusal test / `intent.md` checkbox drift / `pipeline_list` projection:** Follow-up or housekeeping, not blocking this behavioral unit.