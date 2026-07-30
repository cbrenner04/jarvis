Verifying the advocate's key findings against the implementation before issuing the verdict.
## Verdict — required outcomes

### 1. Same-daemon approve/reopen must resume dispatch or stop promising it

**What must be true:** After `pipeline_decide_approval` records `approved`, or `pipeline_reopen_failed` applies, an operator on the admitting daemon can complete the eligible continuation without restart reconciliation — **or** handlers and `daemon-host.md` must not chain activation and must state that continuation requires an `interrupted` pipeline plus `pipeline_activate` / `pipeline_continue`.

**Why:** `runPipeline` leaves `pipelines.status` as `active` when it stops at an approval gate. `claimPipelineContinuation` only succeeds when `status = 'interrupted'`. Handlers chain `activateDurablePipeline` after approve/reopen, so the normal same-session path persists the stage change but returns `activation: { refused, reason: "claim-refused" }` with no dispatch. Docs say decide/reopen “immediately runs the same activation path” with no interrupted prerequisite. Subspec 07 ACs are post-restart-scoped and pass, but the checklist task to wire approve/reopen into activation and the documented operator contract are not satisfied for the live-daemon case.

---

### 2. `pipeline_decide_approval` must bind decision to the supplied pipeline

**What must be true:** The handler refuses (without mutating stage rows or attempting activation) when `stageRecordId` does not belong to the supplied `pipelineId`.

**Why:** `decideApproval` is keyed only by durable row ID and authored `stageId`. A mismatched `pipelineId` can record a decision on pipeline A and attempt activation on pipeline B. The RPC surface requires `pipelineId`; callers will treat it as authoritative.

---

### 3. Handler-level tests for new pipeline RPCs

**What must be true:** Tests invoke `pipeline_continue`, `pipeline_activate`, `pipeline_decide_approval`, and `pipeline_reopen_failed` through `createRunControlHandlers`, covering at least: approve→activation chaining, reopen→activation chaining, and `pipelineId`/stage cross-validation.

**Why:** Module-level tests on `continueDurablePipeline` / `activateDurablePipeline` satisfy subspec 04/07 letter for interrupted pipelines but leave the RPC seam (handler wiring, `activePipelineLoops`, response shapes, chaining bugs) unguarded. `daemon-pipeline-start.test.ts` sets the precedent; handler tests would have caught outcomes 1 and 2.

---

### 4. If same-daemon resume is implemented, loop registration must be consistent

**What must be true:** Any path that starts a pipeline loop after approve/reopen on an `active` pipeline uses the same in-memory loop guard as `pipeline_continue` / `pipeline_activate` (including consideration of whether `pipeline_start` should register its loop).

**Why:** Only a follow-on if outcome 1 chooses implementation over doc narrowing. Fixing claim/resume without unified loop tracking reopens duplicate-dispatch risk.

---

## Not required in this actuator pass

- **`pipeline_continue` without activation eligibility** — intentional split; safe (re-enters loop, gate blocks again).
- **`reopenFailedPipeline` without ownership/status guard** — out of subspec 06 scope; repository primitive.
- **`interrupted` workflow rows re-dispatched on continuation** — consistent with restart-resume; document separately if desired.
- **Corrupt approval statuses vs `derivePipelineState`** — corrupt-data edge only.
- **`intent.md` unchecked rollup ACs** — spec housekeeping, not implementation gap.
- **Optional context at `createPipeline`, missing context JSON validation, `JSON.parse` on corrupt rows** — existing layered design; not introduced by this branch.