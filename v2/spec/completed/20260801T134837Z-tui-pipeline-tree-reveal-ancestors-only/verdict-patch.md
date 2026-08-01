Verifying the advocate's key finding on test coverage before issuing the verdict.
## Verdict — required outcomes

1. **`kill and pause controls no-op when a pipeline or stage row is selected` must exercise the stage path.** Today the stage `selectNode` call cannot succeed with a collapsed parent pipeline: `selectNode` only acts on ids in `monitorSelectableNodeIds`, and a collapsed pipeline hides stage rows from that list. Selection stays on the pipeline, so the subsequent pause/kill calls only cover the pipeline branch while the test title claims both. After ancestors-only effective expansion, the test must reach a genuinely selected stage row (e.g. by durably expanding the parent pipeline first, or by navigation that lands on a visible stage) and assert pause/kill still no-op there. **Rationale:** Silent loss of the stage branch is a real coverage regression unrelated to the subspec’s scope; the test should match what it claims to guard.

---

No other outcomes are required for this patch.

- Core fix (`expandedNodeIds ∪ ancestors(selectedNodeId)` only), flatten regressions, reveal-on-select pins, runbook correction, and the named entry expansion test reconciliation satisfy the subspec acceptance criteria.
- Collapsed-pipeline navigation limits, full `j`/↓/↑ narrative, entry-layer stage `e` round-trip visibility, optional flatten kind/pipeline pins, and parent `intent.md` wording are correctly deferred to `tui-entry-tree-viewport-and-navigation` or are optional hardening—not ship blockers for this atomic change.
- Load-bearing `toggleExpansion()` setup in entry tests is an acceptable harness constraint (programmatic selection requires visible ids), not a behavioral defect.