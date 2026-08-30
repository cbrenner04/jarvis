Verifying the key documentation and test gaps cited in the review before issuing the verdict.
## Verdict: required outcomes

### 1. Align `v2/docs/pipeline-execution.md` with landed dispatch behavior

**What must be true:** The merge-day dispatch section and pending-boundaries table must describe the current production path: stage resolution through `preparePipelineStageWorkflow` → `prepareWorkflowStart` (stamped steps, no dispatch-time re-stamping), shared stale-reset preflight for all workflow stages including fan-out, and project-config-owned implement review policy. References to `FIXED_REVIEW_PASSES`, dispatch-time `stampPipelineDispatchSteps`, intent-only `intentStaleReset`, and a **Pending** shared front door must be removed or replaced.

**Why:** This file is the durable execution home for pipeline dispatch and is linked from the four docs already updated in subspec 02. It still contradicts both the implementation and those docs. Subspec 02's problem statement called out stale durable docs broadly; the seed spec (`pipeline-dispatch-shares-cli-front-door.md`) explicitly names this file. Leaving it stale violates single-home documentation policy and misleads operators.

---

### 2. Reconcile the contradiction in `v2/docs/workflow-runner.md`

**What must be true:** The pipeline posture section must not simultaneously claim stage `review` is unconsumed at run time (line 179) and that stage `review` selects the executable preset while project config owns implement review shape (line 181). One coherent statement must remain.

**Why:** Subspec 02 ticked the workflow-runner doc criterion; the landed paragraph at line 181 is authoritative. The leftover line 179 directly contradicts it and undermines the documented implement review-ownership contract.

---

### 3. Retarget stamping regressions to the production preparation path

**What must be true:** Tests that guard configured `fixCommand`/`readyCommand` (and related machine-config stamping) on pipeline dispatch must exercise the path where production stamping now occurs — resolution through shared preparation — not the orphaned `stampPipelineDispatchSteps` helper. Mutation checkpoints and test comments must anchor on that live path.

**Why:** Subspec 00 moved stamping authority from `advanceWorkflowStage` / `runFanOutBranchAction` into shared preparation. Existing `pipeline-stage-dispatch.test.ts` regressions still call `stampPipelineDispatchSteps` in isolation with `@mutate` anchors on dead dispatch-time code; they would stay green if resolution-time stamping broke. Parity and structural guards partially cover this, but the dedicated stamping regressions currently provide false confidence on the behavior this spec changed.

---

### Not required for this pass

- Driving parity through `runWorkflowCommand` / `workflow.ts` — subspec 02 pins parity at the `prepareWorkflowStart` boundary with normalized builder input.
- Restoring stage `review` posture as implement review-behavior override — spec decision ledger explicitly removed that.
- Stamping custom-injected test builders — production uses default builders; injection seam divergence is acceptable.
- Additional plan/implement stale-reset success-path tests, fail-open doc expansion, `stampPipelineDispatchSteps` deletion, structural guards on `pipeline-execution.ts`, seed-spec checkbox hygiene, or `destroyedArtifacts` pipeline surfacing — reasonable follow-ups, not blockers against the three subspecs' acceptance criteria.