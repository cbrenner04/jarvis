Validating the spec against the codebase before issuing the verdict.
## Verdict: required refinements

1. **Align `intent.md` with subspec wait scope.** `intent.md` still limits removal to “selection-driven `wait` RPC,” while the subspec correctly removes the entire monitor `wait` producer stack (open-time wait, owner-reconnect re-wait, resume re-wait, `TuiWaitState`, wait-token bookkeeping). On main, `wait` is issued on initial selection (~546), owner reconnect (~594–597), and successful resume (`runSteeringAction("resume", true)`). Intent decisions and acceptance criteria must state full monitor `wait` removal and the resume no-re-wait decision, or reviewers will under-scope the work.

2. **Fix the wait-removal pin contract (name, scope, and AC).** Tasks require zero `wait` RPCs for the whole monitor session (open plus selection change), but the AC titles the pin `selection change issues no wait RPC`. On main, open alone issues `wait:run-alpha`, so the title understates the pre-fix failure and weakens the failing-test AC required for runtime behavior changes. Rename/clarify the pin and matching AC so they assert session-wide zero `wait` against a fake daemon client, exercising at least open and one selection change; owner-reconnect coverage is desirable given reconnect re-wait exists today.

3. **Add an acceptance-gated guard for resume no-re-wait.** The subspec documents that `resumeSelected` clears steering feedback on success but does not re-issue `wait`. That reverses current behavior guarded by `successful resume re-issues wait and abandons a prior ready snapshot`. Resume is a documented behavior change with no automated AC today. Add an AC (or extend the entry pin) that drives `resumeSelected` and asserts no additional `wait` calls.

4. **Tie wait-stack deletion to acceptance, not only tasks.** Removing `waitState` from `TuiMonitorState` plus typecheck forces fixture updates, but does not require deleting or rewriting wait-specific entry tests (`selecting a quiescent run waits…`, `changing selection while wait is pending…`, `a reconnected owner socket re-issues…`, etc.). Add an AC that those wait-polling entry tests are removed or replaced so an implementer cannot leave red tests or skip explicit cleanup.

5. **Fix mutation-checkpoint task wording for windowing.** The windowing AC requires a `// @mutate` directive, but the task describes reverting to the pre-fix `monitorSelectableRuns(…).find(…)` expression. Spec guidance requires inverting the **implemented** guard with a valid `"original" -> "replacement"` pair anchored on a unique post-fix line (e.g. membership in `monitorSelectableNodeIds`). Task language must require that form so the checkpoint is parseable and goes RED after land.

6. **Expand documentation updates beyond `operator-runbook.md` § Observe and `v1-behaviors.md`.** Behavior changes that alter existing functionality must keep the parity catalog current, but `v2/docs/write-behavior.md` still documents the outcome panel, selection-driven `wait`, and resume re-wait; `v2/docs/first-workflow-walkthrough.md` still describes Outcome from daemon `wait`; `v2/docs/operator-runbook.md` dock copy still references runs that “cannot be … waited on.” Documentation updates must cover these surfaces (right-pane detail windowed to `monitorSelectableNodeIds`, monitor `wait` RPC removed) so operator docs match shipped behavior.

## Rationale

Intent/subspec drift and the misnamed wait pin undermine review and implement scope. Spec guidance requires a failing-test AC for each runtime behavior change and a valid `@mutate` on the implemented guard; resume no-re-wait is an unguarded behavior reversal. Stale `write-behavior.md` and walkthrough copy would document behavior this spec explicitly removes. Single-subspec shape is acceptable: wait removal and windowing share one operator story (one selectable-run notion, no dead polling), separate failing tests, and coordinated fixture cleanup; splitting would add merge overhead without independent review benefit.

## Not required

- Splitting into multiple subspecs.
- Optional pins for collapsed-workflow stale selection or `"No run selected."` placeholder semantics.
- Widening the typecheck AC beyond compile propagation (unless prose hygiene under `v2/src/tui/` is desired).
- Naming every preservation test in tasks (`unattributed run detail preserves null…`, etc.) — typecheck plus global fixture-stripping tasks suffice if wait-removal ACs above are added.