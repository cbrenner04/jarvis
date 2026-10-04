Reviewing implementation and docs against the spec to issue a verdict.


## Verdict — required outcomes

1. **Correct `v2/docs/daemon-host.md` § Live controls on workflow `activeRuns` lifetime**  
   The section must not say per-step `activeRuns` rows exist only “while that step is in-flight.” Runtime keeps claim and every step `runId` in `activeRuns` until the invocation’s background work finishes (bulk delete in `.finally`). That mismatch breaks subspec **01** (daemon-host is the durable home for live-control semantics) and misleads operators about when `kill` can succeed.

2. **Document the full operator-visible kill rule in the same durable home (`daemon-host.md` § Live controls)**  
   Align prose with subspec **00** Decisions:
   - `kill` is authorized when `activeRuns` has a `workflow` row whose `runId` equals the argument (same lookup shape as write-loop: ownership key, then run id).
   - `list` `isLive` is `in-progress` ∧ membership in the live set; when `isLive` is true for that id, `kill` must succeed; the converse is not required—rows can remain in `activeRuns` briefly after durable status is no longer `in-progress`.
   - One shared `AbortController` per invocation: `kill` on any still-tracked step `runId` (including a **completed** sibling while a later step is running) aborts that shared controller and stops the in-flight agent work; `commitGuardedKill` applies only to the **named** id and no-ops on already-terminal durable rows.
   - `pause`/`resume` on workflow rows remain `run_not_active`.

   **Rationale:** Subspec **00** records this behavior; subspec **01** is marked done but omits the surprising shared-controller case. Operator docs should match what the daemon does, not only “you can kill live workflow steps.”

3. **Add a regression test for shared-controller kill via a completed sibling step id**  
   While step 2 is held live after step 1 has durably `completed`, `kill` on step 1’s `runId` must return `{ ok: true }`, step 1 must stay `completed`, and the invocation must abort so step 2 settles `killed` (or equivalent assertions on the in-flight step).  
   **Rationale:** Subspec **00** treats this as intentional; without a test, the most operator-surprising path is undocumented in executable form and can regress silently.

**No other actuator work required** for subspec **00**/**01** acceptance: liveness-only authorization, signal injection, settlement/rollup, pause preservation, write-loop kill path, and guard-inversion anchors match the completed ACs. Defer `commitCompletionBoundary` vs `killed` races, `executeWorkflow` throw + `settleFailedWorkflowRun` interleaving, non-agent tail cancellation, test-only export cleanup, and intent.md checkbox hygiene unless reproduced or scoped in a follow-up spec.