Verifying the critical race and other upheld findings in the implementation before issuing the verdict.
## Verdict

### 1. Fix durable stage-admission rollback under contention (ship blocker)

Recovery rollback must not release a stage-admission claim this request did not win. Today `releaseDurableAdmission` is set from a pre-claim “absent” snapshot; if another caller wins `claimPipelineStageAdmission` before recovery is refused with `stage_claimed`, rollback can delete the winner’s row while dispatch/recovery is still in flight. That breaks the spec requirement that early refusals leave durable stage-admission unchanged and preserve an existing owner.

**Required outcome:** Rollback releases durable stage admission only when this recovery request actually acquired it (or equivalent identity-safe behavior). A concurrent recover-vs-dispatch (or dual-recover) regression must prove a losing recovery leaves the winner’s admission intact.

### 2. Repair the dead `worktree_claimed` mutation checkpoint

The `@mutate` guard in `daemon-pipeline-recover.test.ts` still targets removed `recoveryClaimError` logic. The assertion still passes via shared admission, but the checkpoint no longer guards against regression.

**Required outcome:** Repoint the mutation to the current shared admission refusal path so removing ownership checks would fail the test.

### 3. Align the recovery outcome table in `pipeline-execution.md`

The paragraph under blocked plan-stage recovery was updated for shared `admitWorkflowStart`, ownership/memory precedence, and rollback semantics; the outcome table above it still describes the old “worktree claim free; `claimPipelineStageAdmission` won” model and omits `insufficient_memory` and shared admission ordering.

**Required outcome:** The table matches the updated paragraph and operator-visible refusal/admission behavior documented elsewhere.

---

**Not required for this subspec:** Keeping `admitAndRecoverPipelineBranchStage` as a direct-call seam, dispatch-vs-recovery durable-stage asymmetry (dispatch claims stage admission before workflow start), structural test transitivity through `handleWorkflowStart`, frozen pre-admission target resolution, workflow-only pre-admit checks, async admission boundary, happy-path coverage via `admitAndRecoverPipelineBranchStage`, log-open-before-claim ordering, duplicate stale-claim reclaim, and `intent.md` checkbox drift (process hygiene only).