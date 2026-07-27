## Verdict — changes required

### Blocking

1. **`review: "none"` must actually suppress review.** The posture→preset table is a naming fiction: `WORKFLOW_PRESET_BUILDERS.intent` and `intent-reviewed` are the same function, as are `plan` and `plan-reviewed`. What suppresses review is `reviewPasses === 0`; behavior defaults to `light` (intent) and `debate` (plan) when unset. Because the resolver hardcodes `reviewPasses = 1` and never passes `reviewBehavior` for intent/plan stages, an authored `review: "none"` stage builds *with* a review pass — a debate pass for `plan`. Outcome: a stage's built steps must carry review configuration derived from the stage's own posture (`none` → zero review passes; `light`/`debate` → an explicit matching behavior), never a preset-name coincidence or a builder default. This is exactly the "no silent substitution of a review default" decision in subspec 00, and it costs money on every run.

2. **Stage settlement must never wedge.** The dispatcher treats only `failed`/`blocked`/`killed` as terminal non-success and writes nothing for any other status — but `interrupted` is a genuine terminal non-success, and any other returned status leaves the row `running` forever while the progression loop still writes `skipped` to every later stage. Outcome: any settlement result other than success must settle the stage as failed with a failure detail; no path may leave a dispatched stage permanently `running` while later stages are marked `skipped`.

3. **`derivePipelineState` must not report `succeeded` at an approval gate.** For a definition ending in an approval stage (e.g. `[workflow, approval]`) with all workflow rows `succeeded`, the all-succeeded check fires before the approval walk and returns `succeeded`; subspec 02 defines that state as `awaiting-approval`. A pipeline with zero workflow stages also reports `succeeded` vacuously. Outcome: an undispatched approval stage that is next in order yields `awaiting-approval`; `succeeded` requires every workflow stage succeeded *and* no pending approval gate. Add coverage for approval-as-final-stage.

4. **A thrown error must not strand the pipeline.** `getBaseBranch` performs real I/O, store calls and the wait primitive can reject; today the rejection is only `console.error`'d with no row written, leaving stages `pending`/`running` forever. Subspec 00's "returns a failure rather than throwing" is honored only for failures the module manufactures. Outcome: an unexpected throw anywhere in a stage's resolve/dispatch/settle path records that stage `failed` with a failure detail and skips the remainder, same as any other failure.

5. **Pipeline stages must run under the same workflow configuration as the equivalent CLI workflow, or the divergence must be documented as deferred.** The CLI workflow path applies iteration bounds, configured idle-output and review-role timeouts, and stale-workspace reset for `plan`/`implement` before dispatch; the resolver dispatches raw builder output. Outcome: either apply the same post-processing, or state the divergence explicitly in `v2/docs/daemon-host.md` as a known deferral — silent divergence is not acceptable.

6. **Tests must be able to fail.** Several assertions are self-confirming rather than mutation-sensitive: `expect(result.ok).not.toBe(true)` beside a sibling asserting `.toBe(false)`; `.toBe(x)` followed by `.toEqual(x)` on the same value; a "project default" inversion check for a default that exists nowhere in the code. And no test exercises the real preset builders — that gap is what hid issue 1. Outcome: the guard-inversion criteria must be backed by assertions that genuinely go RED under the stated inversion, and at least one test must resolve a stage through the real `WORKFLOW_PRESET_BUILDERS` and assert the resulting steps' review configuration per posture (including `none`).

7. **Ordering assertions must not depend on microtask counts.** The bare `await Promise.resolve()` ticks encode the current await-depth of the resolve/dispatch chain; one added `await` upstream turns them into false passes. Outcome: anchor "stage N+1 not yet dispatched" on an observable event (the wait fake having been called), not on tick counts.

8. **Revert the unrelated `workflow-runner.ts` change.** Removing the exported `ReviewMutationResumeDeps` alias and inlining it at four sites is outside all three subspecs' scope.

### Required, smaller

9. **Do not record success with an empty spec path.** `specPath: entryRun?.specPath ?? ""` turns a missing entry run into a silently empty input for the next stage. A missing entry run or spec path at success time must settle the stage as failed, not succeed with `""`.

10. **Walk stage rows, not the definition array.** Subspec 02 specifies the loop walks `loadPipeline(...).stages` (ordered by stored `position`, documented as authoritative). They coincide today; align them so they cannot drift.

11. **Document the `failureDetail` union.** Four distinct shapes are written (`{message}`, `{code,message}`, the composed operator error, a hand-built `{reason,retryable,nextAction}`). Either normalize to one shape or document the union in `v2/docs/state-store.md` so a future consumer is not left to discriminate.

12. **Drop the `invocationId ?? runId` fallback.** `entryRunId` is already carried; substituting it for an unknown invocation ID makes the recorded field ambiguous. Omit it when unknown.

13. **Tighten admission docs.** `pipeline_start` is live in the handler map and accepts an unvalidated definition on the caller's word; `v2/docs/daemon-host.md` must state that the caller owns validation. Also note the same-session retire window between stages (`hasActiveRuns()` is false in the gap between two stages), and correct the doc's `projectRegistry`/`targetDir` description and table padding.

### Not upheld

- Deferring `PipelineDefinition` validation to the caller and letting a structurally invalid ordering (`[plan]`, `[plan, intent]`) fail as a recorded stage-one resolution failure are spec-sanctioned; no admission-time ordering check is required in this slice.
- `derivePipelineState` having no production consumer is covered by subspec 02's observability deferral — but it means issue 3 ships undetected without a test, which is why that fix is blocking.
- The `input as unknown as ...` casts at the builder call sites follow the existing `WORKFLOW_PRESET_BUILDERS` signature and the CLI's own convention; not a defect on their own. Tightening the posture-table key types to the workflow/review unions is still worth doing — it would have caught issue 1 at compile time.
- The in-process `pipeline_start` test not opening a real socket is acceptable under the criterion's "or a direct `loadPipeline` read", but the disconnect half is currently asserted only in a comment; an IPC-level variant is desirable, not required.