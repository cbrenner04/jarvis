Reviewing the implementation and tests against the binding subspec to issue a verdict.
## Verdict — required outcomes

### 1. Guard right-pane detail for off-pane tree selection

**Outcome:** Overflow coverage must prove that when `selectedNodeId` is a tree row id beyond the painted viewport, `monitorRightPaneSegmentRows` returns the correct pipeline or stage detail—not `"No run selected."` Reverting detail lookup to the painted `treeRows` slice must fail a named `Mutation checkpoint:` pin.

**Rationale:** The binding subspec names this failure mode in the problem statement, requires right-pane resolution from the full flattened tree (decision + task), and the implementation already uses `fullTreeRows`. Selectable overflow pins guard the same seam for navigation but do not cover the right-pane consumer; a lookup reversion would leave every checked acceptance criterion green. That gap contradicts the stated fix and normal regression practice for a behavior explicitly bound in the subspec.

---

### 2. Align `intent.md` with the binding subspec

**Outcome:** `intent.md` must reflect the contract in `00-monitor-scroll-viewport-selectables.md`: updated problem (shared trimmed/sliced source post–slice 00, not flatten-time drops), decisions (no idle-FIFO reintroduction, top-window paint, interim selectable-but-not-painted UX, right-pane full-flatten lookup, terminal-size and expansion parity), and acceptance criteria consistent with the completed subspec—including checked items, tree-row id vocabulary, mutation-checkpoint expectations, and entry-pin scope (no scroll-follow during walks).

**Rationale:** Plan verdict refinement 4 required intent routing to match the binding subspec on plan merge. `intent.md` still describes the pre–slice-00 failure mode, unchecked stale acceptance criteria, and omits refinements that the implemented branch depends on. Routing from intent alone would under-specify or misdirect follow-on work.

---

### Not required (no actuator action)

- Expanded-tree overflow fixtures, entry-level e2e proving `j`/`k` lands on a specific off-pane id with live detail, scroll-follow or selection-in-paint during navigation walks, dead `maxVisibleRows` flatten parameter cleanup, memoization of “derive once per snapshot,” or `leftPaneTreeRowIds` helper precision—these are optional hardening, interim UX correctly deferred to slice 02, or out of scope per the subspec and verdict-plan.
- Entry test behavior matches binding decisions (initial selection painted, off-pane selectables exist, navigation loops assert measured-terminal parity only); tightening entry AC prose is optional if outcome 2 aligns intent wording.