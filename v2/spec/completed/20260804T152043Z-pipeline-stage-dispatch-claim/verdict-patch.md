Verifying key implementation points before issuing the verdict.
## Verdict: required outcomes

### 1. Serialize same-process, same-owner concurrent continuations (blocking)

**Outcome:** Overlapping `continuePipeline` callers in the same process with the same owner identity must not both enter `dispatch(steps)` for the same `(pipelineId, stageId, branchKey)` while the stage row is still `pending`.

**Rationale:** Subspec 00’s problem statement names this scenario: `claimPipelineContinuation` is re-entrant for the current owner, and durable admission currently mirrors that re-entrancy (`claimPipelineStageAdmission` returns `applied` when the holder matches). That leaves the stated root cause intact — two continuations can both claim admission and dispatch before linkage is written. Cross-holder SQL tests and a mock that replaces admission with a non-re-entrant boolean do not prove the fix for the named failure mode.

**Required:** Admission semantics (store layer and/or execution layer) must enforce single-flight dispatch for concurrent same-key callers regardless of holder re-entrancy, **and** the subspec 01 regression must use production admission behavior (real SQL store or equivalent), not a stub that hides re-entrancy.

---

### 2. Pin full loser outcome in the concurrent-continuation regression (blocking)

**Outcome:** After both continuations settle, the regression must assert the stage row is not `failed`, has no failure detail, and remains correctly linked to the winner’s live entry run — not only `dispatchCount === 1` and mid-flight `running`.

**Rationale:** Subspec 01 AC: “the loser neither dispatches nor writes `failed` while the winner’s entry run is live.” Current assertions stop before settlement and never check terminal row state against `failed`.

---

### 3. Close the bounded guard-audit task (required)

**Outcome:** The subspec 01 guard-audit deliverable must be satisfied explicitly: either delete a proven-dead guard that assumed stage-row re-read alone prevented cross-continuation double dispatch and wrote `failed` on the loser, **or** extract the `pending` / live-linked `running` stop logic (e.g. in `finishDispatchedWorkflowStage`) into a tested exported predicate with both truth directions covered.

**Rationale:** Task checklist requires deletion or a tested predicate — not an undocumented inline branch. Adding `pending → stop` without either audit documentation or an exported predicate leaves the AC letter unmet.

---

### 4. Direct refused-claim coverage on `dispatchPipelineStage` (recommended)

**Outcome:** `pipeline-stage-dispatch.test.ts` should cover refused-claim paths: early return when row still `pending`; adopt when `running` with live entry run; release on winner completion; no erroneous release side effects on refused early return.

**Rationale:** Subspec 01 lists `pipeline-stage-dispatch.ts` as primary surface; integration test alone with mocked admission leaves refused-claim wiring unverified at the unit boundary. Not a substitute for #1–#3, but strengthens the fix once admission semantics are corrected.

---

### Not required (upheld as sufficient)

- Stale `pipeline_stage_admission` rows after crash/restart — out of scope; operator docs are adequate.
- `loadPipelineStageAdmission` unused on dispatch path — intentional per spec.
- `@mutate` placement — test-file pin on refused-claim guard is correct.
- Double-settle when refused claim routes to adopt — spec-intended; idempotent settlement is acceptable.
- `finally` release on live-entry catch exit — narrow race surface; doc clarification optional, not blocking.
- `intent.md` rollup / migration `021` doc gap — housekeeping, not behavioral defects.