Reviewing the implementation against the spec and key findings before issuing the verdict.
# Verdict: required outcomes

## 1. Restore collapsed-workflow context on grid run rows

**Outcome:** Collapsed workflow groups in the ink left pane must show the same step/status context operators saw before the grid migration (`workflow-step:…` / `workflow-status:…` from `workflowCollapsedContextSuffix`), subject to the fixed `label` column width and `formatTreeCell` truncation.

**Rationale:** Subspec 00 pins label mapping for `workflow-child` but is silent on collapsed suffixes. Intent decision “existing run rows as first consumers” and subspec 01’s left-pane contract require preserving today’s collapsed-row signal. Production ink uses `listMonitorTreeCells`, which omits that suffix; the legacy `renderWorkflowTableRow` path still includes it. This is an operator regression, not an acceptable simplification.

**Test gate:** Pure and/or ink coverage for a `workflow-collapsed` fixture must assert the suffix (or its truncated form) appears in the grid label.

---

## 2. Make non-live liveness readable within the 5-character `live` column

**Outcome:** Non-live runs must not display as the truncated `not-…` in the `live` grid cell. Use a ≤5-character non-live token that fits the brief’s column width (or another representation that remains distinguishable after truncation), and pin it in layout and/or ink tests.

**Rationale:** Subspec 00 maps `live` from liveness text and applies universal truncation; `formatTreeCell("not-live", 5)` yields `not-…`, which is ambiguous and changes operator-visible behavior from the prior untruncated `not-live` segment rows. Brief-aligned fixed width does not excuse an unreadable cell; the token or mapping must change.

**Docs:** If the visible non-live token changes, record it in `v2/docs/v1-behaviors.md` (operator-visible behavior change).

---

## 3. Add workflow-collapse coverage on the grid rendering path

**Outcome:** Automated tests must exercise `workflow-collapsed` rows (and expanded groups with children, if feasible in one fixture) through `buildMonitorTreeRow` / `listMonitorTreeCells` and/or ink grid rendering—not only through `monitorSegmentRows` / `monitorTextLines`.

**Rationale:** Retiring the concatenation pin was correct, but it removed the only cross-path parity check. Ink and the fake view-host now diverge; without collapse fixtures on the grid path, outcome #1 can regress again without failing CI.

---

## 4. Guard stacked `layoutMode` fallback in tests

**Outcome:** Add a sub-120-column test (e.g. `119×72`) that proves stacked pane structure (vertical stack of left+right above dock, not a horizontal split), **or** narrow the split-shell guard-inversion checkpoint so the named mutation fails at the current `245×72` reference geometry.

**Rationale:** Subspec 01 and operator docs promise stacked fallback below 120 columns. The split-shell pin only runs at `245×72`, where split mode is always active; `leftWidth` vs `columns` catches one class of bug but not stacked structural regressions. The `layoutMode` manual AC is only meaningful if the automated pin actually guards the branch.

---

## Not required (actuator may defer)

- **Long `state` values truncating at 12 chars** — consistent with brief degradation; no AC or intent breach.
- **Thicker split-shell partition fixtures** (queue placement, four dock lines, steering in right pane) — subspec 01 AC minimum is met; further fixtures are optional hardening.
- **`[`/`]` nudge with no visual effect in stacked mode** — spec does not require divider adjustment below 120 cols; optional UX/doc note only.
- **`intent.md` unchecked ACs, stale `monitorSegmentRows` comment, `implement-queue.md` seed pointer** — spec hygiene; outside this patch’s code contract.
- **Custom `refreshScheduler` without label override** — subspec 01 AC satisfied for the production default path.
- **Manual guard-inversion ACs** (subspec 00 overflow/empty-slot; subspec 01 divider-session and `layoutMode`) — remain operator/manual verification; no code change required here.