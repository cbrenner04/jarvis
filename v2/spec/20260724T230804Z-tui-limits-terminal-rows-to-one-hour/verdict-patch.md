Reviewing implementation and documentation against the spec to issue a verdict.
## Verdict — required outcomes

1. **Preserve merged daemon order for non-terminal rows after the live-window filter**  
   Subspec 00 requires non-terminal list rows to remain in merged daemon order ahead of terminal rows, with finish-time sort only inside the terminal group. `filterMonitorRunsForLiveWindow` must not reorder non-terminal standalones vs workflow groups relative to the `mergeRunLists` sequence. Active-vs-terminal separation in the table is insufficient; relative order among non-terminals must match the spec.

2. **Collapsed terminal workflows must show a true workflow terminal outcome, not the entry-step run status**  
   Subspec 01 requires the collapsed line to show the workflow’s terminal status after rollup. When later steps fail (or otherwise terminate worse than the entry step), `workflow-status:…` on the collapsed row must reflect that workflow outcome, not the entry representative’s `status`. Add a rendered-monitor test where all constituents are terminal and the final step failed (or otherwise disagrees with the entry step) and assert the collapsed suffix matches the intended rollup semantics.

3. **Document new `list` row fields in `v2/docs/daemon-host.md`**  
   The RPC contract home must describe `finishedAtMs`, top-level `stepId`, and `workflow.invocationId` (and any related attempt `completed_at` behavior operators care about) on par with existing `list` row documentation. Operator-runbook updates alone do not satisfy `documentation-standard.md` for the daemon wire contract.

4. **Prove the twenty-row cap counts collapsed workflow invocations, not constituent runs**  
   Subspec 01 binds the subspec-00 cap to twenty **top-level collapsed** terminal workflow rows. Add coverage (filter unit test and/or rendered monitor text) with at least twenty-one distinct fully terminal workflow invocations in window and assert only twenty appear as top-level collapsed rows in rendered output.

5. **Tighten expanded-workflow tests to assert per-constituent child lines**  
   Subspec 01 acceptance requires distinct role-identifying labels on each constituent run in **rendered** output when expanded. Strengthen `tui-monitor-workflow-collapse.test.ts` so assertions target expanded child table lines (e.g. distinct `role:…` on separate rows), not text that can appear only on the collapsed representative.

**Not required for the actuator (spec-aligned or deferrable):** dropping terminal rows with missing `finishedAtMs`; time-filtering `blocked` like other terminals; client-side partial invocation payloads after filtering; global test inversion flags under serial execution; wiring tests for Ink `e` / `toggleSelectedWorkflowExpansion` (rendered expand state is already in scope); runbook notes on null `completed_at` or long-lived `blocked` unless product intent changes; syncing `intent.md` checkboxes (harness-owned).