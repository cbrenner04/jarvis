Verifying the advocate's critical findings against the implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Production settlement must mirror operator errors from terminal log context

**Outcome:** When the daemon settles a pipeline stage from a non-success entry run in production, `failureDetail` must reflect the full `composeRunOperatorError` result using that run’s terminal log context — including cases like `completion_commit_failed` with `nextAction: "resume"` and `retryable: true` — not generic `harness_failure` / `stop`.

**Why:** Subspec 00’s core fix and acceptance criterion target the production bug (implement stage recording `harness_failure` despite `completion_commit_failed` on the owning run). The dispatch module supports terminal-log mirroring only when callers supply log records; production `pipelineExecutionDeps` does not pass them, so unit tests pass while the real path still calls `composeRunOperatorError` without terminal context. Docs hedging (“when `loadLogRecords` is supplied”) must not remain the production contract once wired.

---

### 2. Subspec 01 `@mutate` checkpoint must target text that exists exactly once

**Outcome:** The live-guard regression in `pipeline-execution.test.ts` must pin a `// @mutate` directive whose source/target strings occur exactly once in `pipeline-execution.ts` and whose inversion makes that regression fail against baseline.

**Why:** Subspec 01 acceptance explicitly requires this mutation guard. The pinned string (`if (isLiveEntryRun(store, record.workflowInvocationId)) return record.workflowInvocationId;`) does not appear in the file; the guard lives in `liveLinkedEntryRunId`. Inverting the pinned text would leave the suite green, defeating the checkpoint.

---

### 3. Stranded-stage reconciliation must not abort on the first live-linked row

**Outcome:** When `failStrandedPipelineStage` encounters a `running` row whose `workflowInvocationId` names a still-live entry run, it must skip that row and continue reconciling other stranded `pending`/`running` rows — not return from the entire function.

**Why:** Subspec 01 requires honoring the live-link invariant without abandoning reconciliation for unrelated stranded stages. Using `return` preserves the live row but stops processing remaining rows, which is a regression in reconciliation behavior.

---

### 4. Operator docs must match actual linkage and catch semantics

**Outcomes:**

- **`v2/docs/daemon-host.md`:** Document that post-admission throws/rejections while the admitted entry run is still live preserve the `running` linkage and defer settlement (no immediate `failed` row); pre-admission throws still record `failed` immediately. Once production log wiring is in place, describe terminal-log mirroring as production behavior, not conditional on optional plumbing.
- **`v2/docs/operator-runbook.md`:** State that a terminal `failed` stage never names a **still-live** entry run in `workflowInvocationId`. Do not claim linkage is “cleared or absent” on terminalization — terminal rows may retain the settled entry-run id.

**Why:** Subspec 00/01 documentation updates and the operator invariant (“a `failed` stage never names a live invocation”) require accurate, non-contradictory guidance. Current docs overstate catch-all failure recording and misstate linkage clearing.

---

### Not required in this pass

- **`running` row pointing at an already-terminal run** — pre-existing wedge; subspec 01 scopes to still-live entry runs only.
- **Re-entry `invocationId` omission, orphan `running` without live linkage** — narrow crash-recovery gaps; out of explicit spec scope.
- **`intent.md` unchecked AC** — harness bookkeeping; subspec ACs are complete. Reconcile if the harness expects intent-level ticks, but not a functional blocker.