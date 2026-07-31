Validating critical findings against the implementation before issuing the verdict.
# Verdict: required outcomes

## 1. Fan-out pipelines with `terminalAction` must not succeed without defined publication

**Outcome:** When a splitting intent (`downstreamInputs` length ≥ 2) is present and the definition sets `terminalAction`, aggregate `succeeded` must not be reported while terminal publication is skipped, and publication must not pick an arbitrary implement branch.

**Rationale:** Subspec 01 defers multi-branch publication policy, not silent success. Today `isPipelineSettlementPending` treats reconciled `default`/`skipped` downstream rows as unsatisfied, so settlement never runs, while `deriveFanOutPipelineState` can still return `succeeded`. `resolveTerminalPublicationInput` would choose one branch by row order if settlement did run. Production definitions use `terminalAction`; `fast` e2e does not cover this. Either make settlement fan-out-aware with an explicit publication contract, or fail closed (non-`succeeded` aggregate, test-covered) until multi-branch publication is defined.

---

## 2. Failed-pipeline resume must not contradict pinned per-branch continuation

**Outcome:** After partial fan-out failure (one branch failed/rejected, sibling succeeded or still actionable), `pipeline_resume` / `reopenFailedPipeline` / `isPipelineContinuable` must either support per-branch recovery or refuse with a documented, deterministic reason — not `malformed_continuation` / `multiple_failed_stages` from branch-blind analysis of reconciled `default`/`skipped` rows.

**Rationale:** Subspec 01 pins that `continuePipeline` / `resumePipeline` advance actionable per-branch rows independently and that one branch’s failure does not abort siblings during the initial run. Initial `runPipeline` satisfies that; post-hoc resume does not. `analyzeFailedPipelineReopenShape` allows one failed row and predecessors only `succeeded` | `approved`; `reopenedFailurePermitsActivation` blocks on any `failed` row. Mixed fan-out outcomes are a normal shape this spec introduces.

---

## 3. Durable docs must match implemented fan-out consumption

**Outcome:**

- `v2/docs/v1-behaviors.md` — intent-finalization resume bullets currently nested under “Pipeline branch fan-out execution” belong under “Intent finalization recovery for a populated stage.”
- `v2/docs/state-store.md` — `downstreamInputs` must be described as consumed by resolution/execution (aligned with `daemon-host.md`), not “no consumer yet.”
- `v2/docs/daemon-host.md` — state that aggregate branch failure is available via `derivePipelineFailureDetail` at derivation time; `pipeline_list` / `pipeline_wait` projection remains deferred to the operator-CLI sibling.

**Rationale:** Behavior and artifact shape changed; documentation-standard requires same-subspec alignment. The `v1-behaviors` nesting is a copy error that misroutes readers.

---

## 4. Duplicate derived `branchKey` must fail admission, not silently continue

**Outcome:** When `downstreamInputs` map to the same `branchKey` (basename collision), fan-out admission must refuse or fail with a clear error — not swallow `createPipelineStageBranch` failures and leave orphan `default` rows or ambiguous dispatch.

**Rationale:** `branchKey` is pinned as ready-intent basename; collisions are outside the landing contract but produce undefined state if ignored. Fail-loud is the correct default for operator-owned daemon execution.

---

## Not required in this actuator pass

- `pipeline_list` / `pipeline_wait` branch projection — explicitly deferred to `pipeline-branch-operator-cli`.
- Persisting `derivePipelineFailureDetail` on the pipeline row or RPC snapshots — deferred with operator observation work; helper satisfies subspec 01 ACs.
- Plan-stage resolution returning multi-result without a `branchKey` parameter — matches subspec 00/01 split; execution coordinates dispatch.
- E2e approval-gate fan-out on real worktrees — gate isolation covered in subspec 01 unit tests; subspec 02 scoped to `fast`.
- Enumerating both rejected and failed `branchKey`s when both occur — minor; current rejection-priority behavior is acceptable unless a follow-up pins full enumeration.
- Both-branches-fail test — coverage gap only; not AC-required.