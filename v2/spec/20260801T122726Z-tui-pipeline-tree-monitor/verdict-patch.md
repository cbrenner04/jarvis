Verifying the advocate's upheld findings against the spec and implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Durable expansion must be owned by `e` only

**Outcome:** Navigating (`j`/`k`/arrows, programmatic `selectNode`) must not write to `expandedPipelineNodeIds`. Ancestor/descendant visibility while a pipeline or stage row is selected must come solely from passing `selectedNodeId` into the tree flatten path (transient reveal-on-select). `expandedPipelineNodeIds` changes only when the operator presses `e` on a selected pipeline or stage.

**Why:** Subspec 02 explicitly keeps reveal-on-select in the pure flatten path and rules out duplicating it in entry or ink. Operator docs state selection reveals ancestors *without persisting expansion*. Current `setSelection` persists the full effective expansion set, so navigating away from a stage can leave constituent runs visible as if `e` had been pressed. That breaks the `e` contract and contradicts documented behavior.

**Verification:** After selecting a stage (without pressing `e`), constituent rows are visible only while that stage remains selected; navigating to another row collapses them unless the stage id was added by `e`. Entry tests that expect constituents to remain visible after navigating away from a non-`e`-expanded stage must be corrected.

---

### 2. Ink monitor must use the same `nowMs` as entry

**Outcome:** Left-pane tree derivation and right-pane segment resolution in the ink shell must use the clock supplied by entry refresh deps (`deps.nowMs`), not wall-clock `Date.now()`.

**Why:** Subspec 00 requires `nowMs` from entry into left-pane derivation; tests inject a fixed clock. Hardcoded `Date.now()` in ink can desynchronize unattributed window filtering and right-pane lookup from navigation/refresh logic under injected clocks.

---

### 3. Daemon disconnect must clear unresolvable pipeline/stage selection

**Outcome:** When a daemon connection drops, selection must clear (and wait state reset) not only for run leaves owned by that daemon, but also when `selectedNodeId` is a pipeline or stage node whose metadata no longer resolves after the disconnect (e.g. its snapshot came from the dropped socket).

**Why:** Subspec 01 requires stale `selectedNodeId` to clear when the node disappears from the selectable list. Disconnect currently checks only run ownership; pipeline/stage ids survive until a later refresh, leaving a selected node with empty or misleading right-pane content.

---

### 4. Add depth-3 indent coverage for expanded-stage workflow children

**Outcome:** Left-pane derivation or shell-layout tests must pin that `workflow-child` rows under an expanded stage render at depth 3 with correct indent column slots.

**Why:** Subspec 00 AC pins multi-level depth indentation; pure tree tests cover depth 3, but the monitor-lines/shell path that ink actually uses stops at depth 2. A regression in depth-aware run rendering would not be caught.

---

### 5. Align `intent.md` with shipped subspec semantics

**Outcome:** Top-level intent prerequisites and acceptance criteria must match completed subspec behavior: collapsed stage shows one `workflow-collapsed` representative row (not zero runs), `e` replaces flat workflow invocation expansion, three-deep selection, and operator doc scope. Intent ACs should be ticked or reworded to reflect what subspecs 00–02 delivered.

**Why:** Intent still describes pre–subspec-02 collapse semantics and leaves ACs unchecked despite a completed implementation. This is spec hygiene required for a closed patch, not optional follow-up.

---

### Not required for this patch

- **Left-pane overflow when many unattributed rows exist:** Explicit subspec 00 tradeoff (unattributed rows outside pipeline FIFO; no scroll).
- **Flat `monitorTextLines` / `monitorSegmentRows`:** Ink integration is the operator surface; legacy text path drift is maintainability only unless an operator workflow depends on it.
- **Ink AC calling exported derivation instead of render path:** Thin wrapper; derivation pin is acceptable per TUI test strategy, though weaker than a render-path assertion.
- **`workflow-child` double-indent:** Verify during depth-3 pin work; fix only if layout is wrong, not preemptively.
- **Pruning stale `expandedPipelineNodeIds`:** Low priority; harmless misses today.
- **Cross-daemon duplicate `pipelineId`:** Explicit spec decision.