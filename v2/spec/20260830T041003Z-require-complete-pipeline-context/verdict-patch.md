Verifying the advocate's upheld findings against the code and docs before issuing the verdict.
## Verdict: required outcomes

The primary subspec acceptance criteria are met for admission refusal, fresh execution using reloaded durable context, and fail-closed stage failure before dispatch when a pending workflow stage exists. Four gaps remain relative to the spec’s decision ledger, subspec 00’s wiring task, and the updated sibling docs.

### 1. Continuation eligibility must reject incomplete non-null context

**What must be true:** Every production gate that currently treats any non-null `pipeline.context` as sufficient for continuation (`isPipelineContinuable`, `continuePipeline`, awaiting `resumePipeline`, and any equivalent eligibility checks) must use the same completeness rule as `loadPipelineContext` / `persistedContextLoadPermitsContinuation`: `null` remains absent (`missing_context`); incomplete JSON that parses must not be treated as continuable.

**Why:** Subspec 00 required wiring the loader into `persistedContextLoadPermitsContinuation` so incomplete JSON is distinguishable from complete. The helper was updated but is only exercised in tests; production still gates on `context === null` alone. `pipeline-execution.md` already documents the helper as the continuation gate, so behavior and docs diverge.

### 2. Settlement-pending pipelines with invalid context must fail closed with a durable outcome

**What must be true:** When all authored stages are satisfied and terminal publication is pending, but stored context is absent or fails loader validation, restart sweeps and operator resume must not loop forever with derived `running` and no terminal-publication result. The operator must get a durable terminal outcome (e.g. terminal-publication failure) or an equally visible refusal — not silent no-op on each continuation attempt.

**Why:** `runPipeline` validates context then calls `failFirstPendingWorkflowStageOnContextError`, which only acts when a pending workflow stage exists. At settlement-pending there are none, so validation failure returns early and never reaches `settlePipelineTerminalPublication`. `isPipelineContinuable` still returns true because settlement is pending and context is non-null. This is outside the written acceptance tests but contradicts the spec’s fail-closed intent for corrupted legacy rows.

### 3. Blocked-plan recovery must use the shared loader

**What must be true:** `resolveBlockedPlanStageRecoveryTarget` must validate persisted context through `loadPipelineContext` before stage resolution, refusing with the named loader error (or an equivalent refusal that surfaces `pipeline-context-loader`) rather than passing raw JSON into resolution and surfacing a generic `stage_resolution_failed`.

**Why:** Subspec 00’s decision ledger calls for one loader at consumption boundaries. Recovery is a consumption boundary; it was not in subspec 02’s acceptance criteria but is inconsistent with the landed architecture.

### 4. `pipeline-execution.md` must match landed behavior

**What must be true:** The canonical execution doc must reflect required `configPath`, admission validation before persist, fresh execution from reloaded durable context (not RPC bytes), loader-based fail-closed semantics for incomplete persisted JSON, and the actual continuation-eligibility rule once outcome 1 is implemented.

**Why:** `daemon-host.md` defers cross-file pipeline architecture to `pipeline-execution.md`. That file still documents optional `configPath?`, verbatim RPC persistence, and `persistedContextLoadPermitsContinuation` as the live continuation gate. Per `documentation-standard.md`, the durable home must not contradict updated sibling docs.

### 5. Regression coverage for the settlement wedge and wired eligibility

**What must be true:** Tests must prove (a) a settlement-pending pipeline with incomplete persisted context does not remain indefinitely continuable without a durable terminal outcome, and (b) continuation eligibility refuses incomplete non-null context before claim/dispatch. The existing malformed-context tests for pending stages should remain green.

**Why:** Outcomes 1–2 are real control-flow holes not caught by current acceptance criteria; tests should pin the fixed behavior and prevent regression.

---

**Not required for actuator action:** whitespace-only field acceptance, shallow optional-field validation, post-admit reload-failure orphan handling, pre-existing `continued` signaling semantics, null-context message vocabulary in direct `runPipeline` callers, and intent-level artifact-contract process debt. Those are out of scope, by design, or pre-existing.