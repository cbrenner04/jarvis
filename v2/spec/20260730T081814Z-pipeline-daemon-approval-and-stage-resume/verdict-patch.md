Reviewing implementation and docs against the spec to issue an outcome-focused verdict.
## Verdict: refinements required

Core behavior matches both subspecs: stage-ID-scoped decisions, first-writer refusal, reject terminal settlement, awaiting resume without dispatch, failed-only redispatch with predecessor preservation, terminal/deferred refusals, detach semantics, and durable docs are largely in place. Detached admission/continuation, `interrupted` → `pipeline_not_resumable`, and duplicate-resume idempotency are spec-aligned or out of scope. The items below are the gaps that still need action.

### Required outcomes

1. **Complete operator-facing refusal documentation in `daemon-host.md`**
   - Approval RPC refusals must explicitly include `pipeline_not_found` (returned today; only covered by “etc.”).
   - Resume RPC refusals must explicitly include `missing_context` and `claim_refused` on the awaiting-approval path (returned today; not listed alongside terminal, deferred, and reopen refusals).
   - **Rationale:** Subspec documentation updates require RPC contracts and refusal propagation to be documented; undocumented returned reasons break the operator contract.

2. **Add handler-level refusal coverage for `pipeline_approve` / `pipeline_reject`**
   - At least one test per method must exercise the RPC handler (not only `applyPipelineApprovalDecision` / `commitPipelineApprovalDecision`) and assert the refused response envelope for a representative refusal case (e.g. wrong `stageId`, non-awaiting row, or duplicate decision).
   - **Rationale:** Subspec 00 acceptance criteria name “RPC apply vs refusal”; refusal behavior is proven at the execution layer but not at the RPC boundary operators call.

3. **Strengthen resume guard-inversion coverage to match subspec 02 acceptance criteria**
   - Tests must fail if `failed-only redispatch`, `awaiting-no-dispatch`, `terminal-refusal`, or `deferred-state-refusal` behavior is removed from `resumePipeline` — not only if a helper like `isReopenedFailedContinuation` is inverted.
   - **Rationale:** The ticked AC requires guard-inversion for those four behaviors; the current resume inversion test only asserts helper semantics and would still pass if resume branches were deleted.

4. **Cover awaiting-resume admission failures**
   - Tests must prove `pipeline_resume` on an `awaiting-approval` pipeline returns `claim_refused` (and dispatches nothing) when `claimPipelineContinuation` refuses, and `missing_context` when admission context is absent.
   - **Rationale:** These are implemented return paths with no test or doc coverage; they are easy to regress silently.

5. **Align handler test naming with what it exercises**
   - The approval handler timing test title claims both approve and reject; it only exercises approve. Rename or extend so the title matches coverage.
   - **Rationale:** Misleading test names hide contract gaps (reject detach timing is untested at handler layer).

### Not required (no actuator action)

- Changing detached success semantics for approve/resume when background continuation fails (`pipeline_start` pattern; observe via `pipeline_list` / `pipeline_wait`).
- Refusing derived `interrupted` via `pipeline_not_resumable` (pinned in subspec 02).
- Duplicate-resume idempotency or concurrent-RPC hardening (not in acceptance criteria).
- `intent.md` checkbox housekeeping (harness-owned; index/subspec ACs are complete).
- Param validation parity with `pipeline_wait` (consistent with existing `pipeline_start` truthiness checks).
- Mandatory post-reconcile `pipeline_resume` RPC test (approval/restart asymmetry is spec-intentional; execution-layer reopen coverage exists).