## Verdict — 4 required outcomes, no ship blockers

### 1. Doc table must state the full branch-scoped refusal shape (AC miss)
`v2/docs/daemon-host.md`'s `pipeline_resume` response cell declares `{ kind: "refused", pipelineId, branchKey?, reason }`, but the branch-scoped arm of `ResumePipelineOutcome` (`v2/src/daemon/pipeline-execution.ts:131-138`) also carries `stageId?` and `status?`, and the new own-gate test asserts `stageId: "gate"` on the wire. The AC requires the row to record "the unchanged response envelope **with branch-scoped refusal detail**," and the ledger says refusals pass through with `branchKey`, `stageId`, and `status`. The table must reflect the shape a caller actually receives; the § prose describing these as library-side detail does not satisfy the table AC.

### 2. The target branch's reopened suffix must be asserted, and the stub comment corrected
Branch reopen also reopens the target's `skipped` `implement` row, so the continuation reaches that stage unconditionally — where the `resolveStage` stub returns `ok: false` and the row lands `failed`. Today nothing asserts what happens there, so the test passes whether the suffix was reopened or left `skipped` — i.e. a real part of "replays only the named branch" is unpinned. The test's `resolveStage` comment ("implement not needed for this scenario") is factually wrong and must go. Make the target branch's post-continuation suffix state observable and asserted (the existing `dispatchLog` already distinguishes the two states at near-zero cost).

### 3. Make the second mutation checkpoint detectable by its own host test
The directive neutering the guard's presence clause is pinned only by *other* tests in the file, not by the test it is embedded in. That is AC-sanctioned today and the verifier's surface scoping catches it, but it is fragile to test relocation. Add coverage inside `pipeline_resume rejects malformed branchKey with invalid_params` proving an omitted `branchKey` is **not** rejected as `invalid_params`, so the checkpoint is self-sufficient.

### 4. Pin the untrimmed forward
The ledger decides `trim()` is used only to test blankness and that a non-blank key with surrounding whitespace forwards **unchanged**; downstream branch matching compares keys exactly (`pipeline-execution.ts:275`). Nothing on the wire pins this — rewriting the forward as `params.branchKey.trim()` would silently change behavior with the full suite green. Add wire coverage proving a whitespace-padded key reaches `resumePipeline` untrimmed (it must not match the identically-named branch). Pinning `branchKey: "default"` as an alias of omission is optional but welcome in the same test.

---

### Explicitly declined — do not change

- **The `params.branchKey as string | undefined` cast.** Replacing it with a `typeof === "string" ? … : undefined` ternary would collapse a malformed key into unscoped whole-pipeline resume, which the ledger rules out, and would dissolve the documented mechanism of the non-string mutation checkpoint (the handler faulting inside `resumePipeline`). Keep the cast.
- **Settle sequencing in the replay test.** The `waitFor(status === "running")` before `settle()` is no more fragile than the pre-existing pattern it mirrors, and the keystone mutation aborts on the synchronous reopen assertion above those loops, so no hang is reachable.
- **Adding `branchKey` validation to `pipeline_approve`/`pipeline_reject`.** Out of subspec scope; those paths refuse cleanly rather than faulting. Worth a follow-up seed, not this PR.
- **`entryRunId: planAfter?.workflowInvocationId` in the artifact assertion.** Tautological in isolation but harmless; branch attribution is already proven by the `dispatchLog` positive and negative assertions. Tighten only if touching that block anyway.