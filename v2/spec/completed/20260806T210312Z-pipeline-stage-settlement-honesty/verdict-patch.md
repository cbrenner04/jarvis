Verifying production re-settlement wiring and related execution paths against the spec.
## Verdict — pipeline-stage-settlement-honesty

### 1. Production re-settlement must close the deferred→terminal loop

**Outcome:** When a stage is `running` with `workflowInvocationId` set, `failureDetail` shows `settlement_deferred`, and the linked entry run has since become terminal, the documented recovery paths (`continuePipeline`, `advanceWorkflowStage` re-entry, refused-admission adopt, `resumePipeline` / `pipeline_resume`, and startup continuation) must invoke adopt/settlement and produce a terminal stage row whose non-success `failureDetail` mirrors `composeRunOperatorError` (not `harness_failure` / `stop`).

**Rationale:** Subspec 00 defines deferred settlement as transient and names those paths as the retry seam. `adoptAndSettlePipelineStage` already settles `linkedRunning` when the entry run is terminal, but callers gate on `liveLinkedEntryRunId`, which requires `isLiveEntryRun`. After deferral the entry run is terminal, so production callers return `stop` or skip adopt — the shipped docs and ACs describe behavior that does not run.

**Verification:** Tests must exercise at least one production path (e.g. `continuePipeline` or `advanceWorkflowStage` after deferral), not only direct `adoptAndSettlePipelineStage` calls.

---

### 2. Fan-out execution must not treat deferred+terminal as failure or skip suffix stages prematurely

**Outcome:** Fan-out adopt/settle (`runFanOutBranchAction`, `settleFanOutBranch`) must use the same settlement-link criterion as ordered progression: a `running` stage with `workflowInvocationId` pending settlement (including deferred + terminal entry run) must attempt adopt/settlement and must not skip suffix stages or record branch failure solely because `liveLinkedEntryRunId` is undefined.

**Rationale:** Same root cause as #1. A deferred stage is not failed; skipping suffix stages contradicts the settlement contract and can strand pipelines after a normal deferral window.

---

### 3. Stranded recovery must not overwrite deferred rows with generic failure

**Outcome:** `failStrandedPipelineStage` (and any parallel stranded handler) must not terminalize a `running` stage that carries `settlement_deferred` with a generic `{ message }` failure. Such rows must be skipped for generic failure or routed through adopt/settlement like live-linked rows.

**Rationale:** Stranded recovery is a documented retry seam. Overwriting deferred detail destroys operator-visible state and bypasses `composeRunOperatorError` and retarget metadata on the eventual terminal patch.

---

### 4. Suffix progression must remain correct while settlement is pending

**Outcome:** After #1–#3, suffix skip / `finishDispatchedWorkflowStage` / `shouldStopForInFlightStageRow` semantics must not skip later stages or treat a deferred `running` row as settled failure when `workflowInvocationId` is set but the entry run is terminal. Either re-settlement runs first and suffix logic sees the settled row, or pending deferred settlement blocks incorrect suffix skip until settlement completes.

**Rationale:** Deferred + terminal is now a normal durable state. Current helpers treat dead linkage as not in-flight, which drives `skipRemainingStages` and fan-out failure paths without re-settlement.

---

### 5. Adopt-path test must match the mirror-primitive contract

**Outcome:** `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"` must use a `wait` that mirrors `waitForWorkflowEntryRun` rollup semantics: no in-flight promise; rollup derived from durable non-terminal entry-run state (not a constant non-`completed` return while the store still shows live).

**Rationale:** Subspec 00 explicitly rejects stub waits that unconditionally return `failed` over a live store row. The AC is checked but the test does not pin the named contract.

---

### 6. Publisher-layer test for retarget metadata on publication failure

**Outcome:** `completion-publisher.test.ts` must assert that when publication fails after base retarget, `requestedBase` and `resolvedBase` are present on the failure path (publisher result or thrown error augmented for downstream logging), not only via synthetic `loop_finished` injection in `pipeline-stage-dispatch.test.ts`.

**Rationale:** Subspec 01 owns `completion-publisher.ts` and requires retarget metadata on `failureDetail` when publication still fails after retarget. Settlement-boundary tests do not verify the publisher → write-loop → log chain.

---

### 7. Revert unrelated scope creep

**Outcome:** The inlined `reviewMutationPublicationResumable` removal in `workflow-runner.ts` must be reverted or moved out of this change set; it is behavior-preserving but outside all three subspec surfaces and widens review blast radius without spec linkage.

**Rationale:** Code quality / scope discipline; no spec requirement.

---

### Optional (not blocking completion if #1–#6 land)

- **`test.each` over non-terminal entry-run statuses** (`paused`, `budget-soft-stopped`, etc.) pinning deferral — cheap contract coverage aligned with docs.
- **Tick or align `intent.md` acceptance criteria** with completed subspec ACs — documentation housekeeping only.