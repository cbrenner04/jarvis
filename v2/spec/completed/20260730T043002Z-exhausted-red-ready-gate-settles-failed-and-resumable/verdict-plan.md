1. **Rebase after the sibling prerequisite.** Name `terminal-settle-cancels-repair-agent-and-releases-lock` as a prerequisite and redraft after it lands. Both changes affect terminal ownership/finalization, so same-seam work must be planned serially.

2. **Remove stale settlement work.** Exhausted red gates already durably settle as `failed` with `ready_gate_failed`; this cannot serve as a baseline-failing regression. Retain settlement only as preservation coverage. Re-diagnose the merged code and identify a genuinely unfixed, baseline-red resume behavior—or close the spec if none remains.

3. **Define resume eligibility precisely.** Specify which `ready_gate_failed` rows qualify using observable lineage and terminal evidence. Explicitly address other origins of that reason, including timeouts, blocked or unsettled repairs, iteration-limit suppression, and unrelated finalization failures.

4. **Define the finalization-only checkpoint contract.** Clarify what resume must repeat or reuse, including pending operator changes, commit/push/publication state, PR evidence, verification stages, and attribution. “Rerun the gate” must have one unambiguous operator-visible meaning while excluding write-agent re-entry.

5. **Cover the complete resumed lifecycle.** Baseline-failing tests must establish that:

   - A green resumed gate completes the same owning run, makes it non-resumable, and flips ready exactly once.
   - A red resumed gate returns the same run to failed/resumable without agent entry or ready flip.
   - Repeated red resumes remain admissible.

6. **Use the actual durable and API contracts.** Distinguish durable run status, terminal evidence, attempt attribution, and composed operator errors. Assert real response shapes: list `status`, wait `runStatus`, and `error.reason`/`error.nextAction`, without implying those fields all live on the durable row.

7. **Make mutation coverage guard-specific.** Enumerate every added or changed guard—such as status, failure origin, ownership/lineage, retained context, no-agent dispatch, repeated failure, and flip suppression—and tie each to a named positive or negative regression test.

8. **Keep the resulting work atomic.** After removing shipped settlement behavior, scope the spec to the remaining resume contract. If that contract still exceeds one independently testable change, split it into linked subspecs with every retained intent outcome represented exactly once.
