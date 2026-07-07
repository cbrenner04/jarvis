## Verdict

Refine subspec **00-dispatch-core.md**:

1. **Failure path for `onFirstRunCreated`.** The spec only defines the success path (callback fires, promise resolves, `start` returns `{ runId }`). Define what happens when `executeWorkflow` fails or rejects before step 0's run row is created (bad step shape, validation error, etc.) — the handler's awaited promise must settle with an error in this case, not hang forever. Add a decision covering this and an AC exercising a pre-step-0 failure returning an error response from `start`.

2. **`steps: []` is invalid.** Add `steps: []` explicitly to the same rejection bucket as "both present" / "neither present" (`invalid_params`). This also removes ambiguity for the failure-path and ownership-key decisions, which currently presume a first step exists.

3. **Name the headroom-rejection error code.** "Rejected outright" needs a concrete error code. Identify the existing code the bare-`WriteLoopInput` headroom-insufficient path already returns and state that the workflow-start path reuses it (no new code invented).

4. **Single-element `steps[]` is valid.** State explicitly that a one-element `steps[]` is accepted and follows the normal workflow-start path (no minimum-length requirement).

5. **Note the persisted-snapshot assumption.** Add one line stating the workflow-start path persists `workflowSnapshot` via the same `executeWorkflow` entry point the preset path already uses, so subspec 03's rendering reuse has a stated basis rather than an implicit one.

Refine subspec **01-ownership-guard.md**:

6. **Acknowledge the ordering dependency.** State explicitly that ownership enforcement is deferred until this subspec lands, and that subspecs are intended to land in index order — so a bare 00-only deployment has a transient window where a workflow start bypasses claim/queue checks. This is acceptable as a documented sequencing note, not a redesign, but it must be stated rather than left implicit.

7. **Confirm the `(project, branch)` assumption before drafting**, not as a spec decision but as a drafting-time check: the claim that every `AnyWorkflowStep` variant (`write`, `human`, `review-debate`) carries `(project, branch)` fields must be verified against the current union before this subspec's design is finalized. If any variant lacks these fields, the ownership-key derivation decision needs to change.

Refine subspec **02-activeruns-discriminant-kill-pause.md**:

8. **Assign ownership of later-step `activeRuns` entries.** The subspec currently defines only how `kill`/`pause` reject workflow entries, not who creates/updates the `activeRuns` entry as execution advances past step 0. Add a decision naming the mechanism (e.g., extending the `onFirstRunCreated`-style callback to fire per-step-created, with the daemon inserting/updating `kind: "workflow"` entries on each firing).

9. **Make the later-step AC implementable.** The AC "killing/pausing a later step's runId is rejected" requires a way for a test to learn that a later step's run row now exists. Once (8) defines the per-step-created hook, this AC should reference that hook as the observation point instead of leaving the mechanism unstated.

No changes required to **03-list-rendering.md**.

Rationale: items 1, 2, 3, 4 are gaps in "Behavioral acceptance criteria" completeness — the spec guidance requires ACs that are actually verifiable and decisions that are actually implementable in one loop iteration (the intent's stated reason for splitting this work). Item 6 satisfies the guidance's atomicity principle honestly — atomic doesn't mean risk-free, but undocumented risk windows should be named. Item 7 follows the Prerequisites-gate spirit in spec guidance: a load-bearing factual claim about existing code should be confirmed, not assumed, before downstream design commits to it. Items 8–9 are required because an AC must be observable/testable as written (per spec guidance's behavioral-AC rules) — currently the mechanism for populating later-step entries is undefined, so the AC cannot be graded. Item 5 is a low-cost clarification that removes an implicit bridging assumption between subspecs 00 and 03.