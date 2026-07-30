Validating the advocate's key claims against the codebase before issuing the verdict.
## Verdict: required refinements

### 1. Derived state must not report `succeeded` before terminal publication completes
The spec adds a failure predicate on `terminalPublicationFailure` but does not define behavior for the interval after all stages succeed and before settlement finishes. Today `derivePipelineState` returns `succeeded` as soon as stage rows are satisfied, so `pipeline_wait` and any mid-run observer can report completion before `executeTerminalPublication` runs. AC1 states the end state but the decisions/task checklist do not pin the intermediate contract.

**Required:** A decision (and matching AC coverage) that when `terminalAction` is set, derived state stays non-terminal (`running` or an explicit settling/pending marker) until terminal publication succeeds or fails durably. This is necessary to satisfy intent (“pipeline success requires terminal-action success”) and spec guidance (agent-verifiable, observable runtime behavior).

### 2. Crash/restart must not permanently skip never-attempted terminal publication
If the daemon stops after the last stage succeeds but before settlement runs, stage rows read `succeeded`, derived state can read `succeeded`, `isPipelineContinuable` is false, and `resumePipeline` refuses with `pipeline_terminal_succeeded`. Terminal publication is never invoked and there is no durable failure or pending marker to recover from. Deferred retry-after-failure does not cover this case.

**Required:** Either (a) a decision and acceptance outcome that recovery (`continuePipeline` / restart) idempotently finishes pending terminal publication when stages are complete but settlement has not succeeded, or (b) an explicit documented known gap with operator impact stated as a blocker or scoped deferral. Silence leaves a product-correctness hole distinct from the deferred failure-retry sibling.

### 3. `leave-draft` operator path scope must be explicit
AC1 requires driving `leave-draft`, `ready`, and `merge` end to end in `pipeline-execution.test.ts` with a fake seam. That can pass while production still runs `runReadyFinalizer` inside `publishCompletionArtifacts` for `fast` + `leave-draft`, contradicting the executor spec’s completion↔terminal composition rule. Intent and upstream docs treat `leave-draft` as in-scope.

**Required:** An explicit scope decision before merge: expand this spec to own completion skip for `leave-draft`, narrow AC1 to `ready`/`merge` at the pipeline unit layer with `leave-draft` deferred to a sibling or integration proof, or add a prerequisite that the completion-composition surface is merged first. Unresolved, AC1 overclaims relative to operator-visible behavior.

### 4. Pin terminal publication input resolution
The decision that PR evidence comes from “the last succeeded workflow stage artifact” plus “persisted admission context and stage resolution inputs” is too vague for implementers. `PipelineContext` does not carry `worktreePath`, `branch`, or `baseRef`; those live on entry-run linkage and dispatch-time resolution.

**Required:** A decision naming the concrete sources for each executor input field (`prNumber`, `prUrl`, `specPath`, `worktreePath`, `branch`, `baseRef`) and the selection rule (authored-order last succeeded workflow stage; implement stage when `terminalAction` is set is acceptable if stated). Optionally strengthen AC1 to assert the resolved input passed to the fake seam matches that rule.

### 5. Name the settlement guard referenced by AC2
AC2 and the task checklist refer to “its settlement guard” for inversion without identifying the predicate.

**Required:** Name the exported guard (e.g. `terminalPublicationFailure` presence in `derivePipelineState`, or a dedicated helper) in decisions and tie AC2’s inversion hook to that symbol.

### 6. State intentional non-resumability after terminal publication failure
Terminal failure → derived `failed` with all stages `succeeded` → `reopenFailedPipeline` refuses (`no_failed_stage`) is worse for operators than stage failure and is not covered by the deferred retry/resume line.

**Required:** An explicit decision that terminal publication failure is non-resumable in this slice; resume/reopen semantics for this failure class remain deferred to the first consumer. Prevents ambiguity between bug and intentional gap.

### 7. Negative AC: terminal publication not invoked on stage-walk stop
Core decision: settlement runs only after the stage walk completes with no `stop` and every workflow stage succeeded and every approval stage approved. No AC covers the negative path.

**Required:** One acceptance outcome that terminal publication is not called when the walk stops on failed stage, awaiting approval, or rejected approval.

### 8. Clarify AC3 guard-inversion ownership
AC3 lives in `pipeline-execution.test.ts` but the red-gate guard lives in `terminal-publication.ts`.

**Required:** State whether the pipeline test asserts zero merge calls via the fake seam only, or whether inversion runs in executor tests with pipeline asserting suppression—so implementers know where the guard-inversion obligation sits.

### 9. Prerequisite merge ordering for executor spec
Prerequisite cites `v2/spec/20260730T154836Z-execute-pipeline-terminal-publication/`, which is not under `completed/`. Same-seam serial rule requires executor merged before settle implementation.

**Required:** Prerequisite wording that the executor spec is merged (or moved to `completed/`) before settle implementation begins.

### 10. Documentation: add `state-store.md`
Persistence of `terminal_publication_failure` should appear in `v2/docs/state-store.md` alongside prior pipeline-column patterns.

**Required:** Add to documentation updates.

### 11. Edge-case decisions (lower priority, still required)
- **Unexpected throws:** Task checklist mentions `TerminalPublicationError` only; specify whether non-typed throws normalize to durable pipeline failure or use an existing stranded-pipeline path.
- **Missing `context`:** State behavior for pre-migration or contextless pipeline rows at the settle boundary (refuse with durable failure vs. skip with reason).

---

**Not required:** Splitting the single subspec—the store, derived-state, and `runPipeline` post-loop paths are one non-shippable behavioral unit, consistent with sibling daemon pipeline specs. `pipeline_list` failure projection and full daemon/RPC integration remain appropriately deferred to the ready integration intent.

**Merge gate:** Refinements **1**, **2**, and **3** are blocking for product correctness; the spec should not be implemented without resolving derived-state timing, crash-skip behavior, and `leave-draft` scope.