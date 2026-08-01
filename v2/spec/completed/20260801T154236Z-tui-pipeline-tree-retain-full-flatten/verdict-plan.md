Validating key claims against the codebase before issuing the verdict.
## Verdict: required refinements

1. **Clarify slice-00 FIFO scope in `intent.md`**
   - **Outcome:** Intent must state that slice 00 removes *all* flatten-time `dropOldestTerminalPipeline` trimming; idle FIFO when not navigating is slice 01 only.
   - **Why:** The current intent decision (“FIFO eviction … when the operator is not navigating”) reads like slice 00 should retain navigation-aware FIFO inside flatten. That conflicts with the subspec and risks premature idle-FIFO wiring in flatten.

2. **Define entry-test replacement assertions**
   - **Outcome:** The subspec task that relaxes `tui-entry.test.tsx` trimmed-row pins must name the post-slice-00 expectations (full flatten exceeds pane budget; no pipelines dropped from flatten output), not only what to remove.
   - **Why:** Without concrete replacements, implementers can turn `test:v2` green with inconsistent expectations and weaken the handoff to slice 01’s selectable-vs-painted contract.

3. **Preserve active-pipeline mutation guard in the new overflow pin**
   - **Outcome:** The replacement overflow-retention test must use a fixture that includes at least one active pipeline (as the current viewport-FIFO pin does), and retain a mutation checkpoint that re-enabling flatten-time FIFO trimming turns RED if an active pipeline is dropped.
   - **Why:** Replacing the existing pin with a terminals-only overflow test would drop a valuable guard without adding equivalent coverage elsewhere.

4. **Tighten collapsed-subtree test reconciliation**
   - **Outcome:** Reconciling `excludes collapsed pipeline subtrees from maxVisibleRows counting under terminal pressure` must either (a) still pin collapse row-counting behavior without FIFO semantics, or (b) remove/rename the test and update its mutation checkpoint accordingly. An AC must require the reconciled test is not a false-green mislabel of viewport-FIFO behavior.
   - **Why:** After removing flatten-time trimming, that test can stay green while its name and checkpoint still claim `maxVisibleRows` budget semantics under FIFO pressure.

5. **Rename the viewport-FIFO describe block**
   - **Outcome:** When the FIFO pin is replaced, rename `describe("flattenMonitorPipelineTree viewport FIFO")` to match full-flatten retention behavior.
   - **Why:** A green suite with a mislabeled describe block obscures the behavioral contract for later slices.

6. **Add minimal `v1-behaviors.md` reconciliation for slice 00**
   - **Outcome:** Document that flatten no longer FIFO-trims (interim full-flatten until slice 01 viewport paint). Do not defer all behavior-doc updates to slice 02.
   - **Why:** Spec guidance requires `v1-behaviors.md` updates for behavior changes. Committed docs currently describe FIFO eviction during navigation (`v1-behaviors.md` descend-eviction caveat); slice 00 changes that behavior immediately.

7. **Note stale sibling ready-intent prerequisites**
   - **Outcome:** Slice 00 must record that `tui-monitor-scroll-viewport-selectables` and `tui-entry-reversible-descend-navigation` ready-intents list prerequisites that become false after slice 00 lands, and that those prerequisites must be updated before slice 01 plans or runs.
   - **Why:** Serial ordering depends on accurate prerequisites; stale “flatten FIFO-drops when over budget” prerequisites will mislead slice 01 planning.

8. **State slice-00 verification boundary**
   - **Outcome:** Spec must explicitly state that slice 00 proves flatten data retention (every pipeline id in flatten output under overflow); end-to-end navigation reversibility and operator-facing scroll contract are slice 02 (docs) / slice 01+02 (behavior).
   - **Why:** The problem narrative centers on `j`/`k` navigation, but the proposed AC is a static unit pin. Explicit scope prevents slice 00 from being judged incomplete for not fixing navigation integration.

**No split required.** Cross-module entry-test edits and interim unbounded paint are acceptable fallout for one atomic subspec, provided items 2 and 6–8 are addressed.

**Defensible without further refinement:** keeping `maxVisibleRows` on signatures as a no-op until slice 01; keeping `dropOldestTerminalPipeline` for slice 01 idle-FIFO; intent/subspec AC thickness difference under index routing.