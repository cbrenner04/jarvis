Reviewing the spec against the codebase to validate the advocate's refinements before issuing the verdict.
## Verdict: required refinements

1. **Align `intent.md` acceptance criteria with subspec flatten semantics**
   - AC #1 currently says a selected collapsed stage “omits that stage's run rows.” That is incorrect: under an expanded parent pipeline, collapsed stages still emit join-time representative run rows; the fix changes **expanded constituent rows** vs **collapsed representatives**, not presence vs absence of all run rows.
   - AC #1 must use the subspec’s precise contract.
   - AC #2 must require a **multi-member stage fixture** (single-member collapsed/expanded output can be byte-identical, so it cannot prove the toggle).

2. **Task entry-layer test reconciliation forced by `test:v2`**
   - The subspec’s `test:v2` AC will fail until entry tests that encode self-expand visibility are updated — notably `drives pipeline tree expansion through the injected input hook`, which expects constituent run rows visible on a selected collapsed stage before `e`.
   - Add an explicit task (and matching acceptance outcome if needed) to update entry **visibility** assertions to post-fix flatten output while **preserving** durable-state pins (`expandedPipelineNodeIds` membership). Without this, implementers must infer fallout from a green-suite AC alone.

3. **Update documentation — do not defer all docs to the sibling entry intent**
   - `## Documentation updates: None` is wrong. `v2/docs/operator-runbook.md` currently states that the selected node is always self-expanded and `e` on the selected stage has no visible effect — the behavior this spec removes.
   - Per spec guidance on behavior changes, the subspec must own a **minimal** runbook correction (remove/replace the self-expand paragraph; note that full `e`/navigation narrative ships with entry integration). Leaving the runbook describing removed behavior after merge is actively misleading.

4. **Add prerequisites for serial ordering against the sibling entry work**
   - `tui-entry-tree-viewport-and-navigation` lists ancestors-only reveal and bidirectional `expandedNodeIds` flatten deltas as prerequisites — this spec delivers those.
   - Add a `## Prerequisites` section (or equivalent) stating this spec must land before that entry intent / self-expand seed work, and must not be run in parallel with it. Queue-level ordering exists in `implement-queue.md` but is not visible from the subspec alone; without an in-spec pointer, parallel implement runs risk conflicting assumptions.

5. **Optional — not required to ship the atomic change**
   - A pipeline-selected `e` round-trip flatten regression would add symmetric guard coverage but is not mandatory: the same `resolveEffectiveExpansion` loop removal is exercised by stage regressions, mutation AC #3 names re-adding selected pipeline/stage ids, and collapsed-pipeline flatten behavior is already pinned elsewhere.