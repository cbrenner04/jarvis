Reviewing the implementation against the spec and branch summary.
## Verdict — required outcomes

1. **`list` and `wait` must agree on `resumable` per `runId`**  
   Subspec 01 makes row `resumable` the admission answer (`isResumeAdmitted` / `nextAction: "resume"`) on `wait` via `resultFrom`, and on workflow **entry** `list` rows via `workflowEntryResult` → `entryOutcomeFields`. Non-entry workflow step rows still get composed `error` but do not set `resumable`, while `wait` on that same id can return `resumable: true` or `false`. That breaks the intent-level contract (“no operator-visible lie” on `list`/`wait`) and overstates what subspec 01’s doc edits claim. **Outcome:** for every durable run id, when `list` and `wait` both surface terminal outcome context, `resumable` must match; cover with at least one multi-step workflow fixture where `wait` targets a non-entry step id.

2. **Fix reversed causality in `daemon-host.md` RPC copy**  
   The `resume` row still says admission is “derived from the advertised row contract.” After subspec 01, rows project `resumable` from composition/admission, not the other way around. **Outcome:** `resume` (and any terse `list`/`wait` table text that repeats the old story) must describe projection-first causality consistently with the Tie-break and `error.retryable` vs `resumable` sections already updated in this patch.

3. **Subspec 00 integration test must show respawn, not only non-refusal**  
   Acceptance criteria require admission **and** respawn from the persisted snapshot for `ready_gate_failed` + last attempt `blocked`. The current `resume admits ready_gate_failed when repair attempt ended blocked` test only asserts `resume` is not `terminal_run`; neighboring cases assert `fakeExecutor.pendingCount()`. **Outcome:** that case must also prove the run is claimed/spawned after successful resume (same bar as adjacent resume tests).

4. **Keep subspec 00 negative precedence coverage on the shipped helper**  
   Precedence must stay in exported `resolveFailedBlockedAttemptPrecedence`, with a test that fails if resumable finalization stops outranking attempt detail (e.g. `ready_gate_failed` + `resumable: false` → `agent_blocked` / `inspect_spec`, not finalization resume). **Outcome:** do not merge a tree that drops that negative case or inlines precedence back into `composeRunOperatorError` without equivalent tests and a clean complexity lint on `composeRunOperatorError`.

5. **`bun run check` green**  
   Subspec 00 acceptance criteria require it; actuator should run the scoped v2 daemon tests and full check before land.

**Not required for this actuator pass (accepted or out of scope):** exhaustive reason-level tie-break docs for `invalid_token` vs `ready_gate_failed`; duplicating `RUN_OPERATOR_ERROR_RECOVERY` in the runbook; deduplicating `WRITE_LOOP_OUTCOME_KINDS`; double `composeRunOperatorError` on refuse path; ticking top-level `intent.md` acceptance (harness-owned, spec tree read-only here); extra precedence matrix rows beyond AC unless you add them while fixing outcome (1).