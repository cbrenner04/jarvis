# Verdict: required refinements

## 1. Remove slice-02 behavior from slice-01 entry acceptance criteria

The subspec requires that the selected id “remains in the painted slice during forward/back walks.” That conflicts with the slice-01 decision to paint only the top `maxVisibleRows` rows with no scroll offset. Off-pane nodes are intentionally selectable but not painted until slice 02 adds scroll-into-view.

**Required outcome:** Slice-01 entry ACs must only cover (a) the old “every selectable ⊆ painted rows” pin failing pre-fix, (b) the narrowed post-fix contract (selected id ⊆ painted rows; off-pane selectables may be absent from paint), and (c) a mutation checkpoint guarding reversion to the old pin. Scroll-follow selection visibility belongs in slice 02, not here.

**Rationale:** Prevents contradictory ACs, satisfies failing-test guidance (the scroll clause would pass pre-fix and fail post-fix), and matches serial ordering with `tui-entry-reversible-descend-navigation` (02).

---

## 2. Resolve right-pane detail for off-pane tree selection

Separating selectables from the painted viewport means lookup keyed only to painted `treeRows` will miss valid off-pane pipeline/stage/run selections; the right pane can show “No run selected” for navigable nodes.

**Required outcome:** The spec must state an explicit outcome for right-pane resolution when selection is off-pane—either (preferred) detail lookup uses the full flattened tree (same source as selectables) while paint stays viewport-sliced, or a documented interim regression with a failing-then-passing pin deferred to slice 02. Silence is not acceptable.

**Rationale:** Monitor-lines ACs can pass while integrated `j`/`k` + detail-pane behavior is broken. This is the same seam the spec opens; one subspec is still appropriate if this outcome is included.

---

## 3. Close the idle-FIFO handoff from slice 00

Slice 00 deferred idle-FIFO and paint-only trimming to slice 01. Slice 01 never states what happens to that handoff.

**Required outcome:** An explicit decision that slice 01 does **not** reintroduce idle-FIFO eviction; full flatten is authoritative for navigation (and, per refinement 2, for detail lookup if chosen); `maxVisibleRows` caps **painted** tree rows only.

**Rationale:** Closes an orphaned prerequisite/decision chain and prevents implementers from re-adding flatten-time drops that contradict slice 00.

---

## 4. Align `intent.md` with the binding subspec

The subspec adds decisions and ACs not present in `intent.md` (top window, terminal-size parity, expansion parity, mutation checkpoints, entry-pin detail, no test hooks). Routing from intent alone would miss binding constraints.

**Required outcome:** `intent.md` updated on plan merge so prerequisites, decisions, tasks, and acceptance criteria reflect the subspec’s binding contract (minus slice-02-only items removed per refinement 1).

**Rationale:** Serial-order context and intent routing must not under-specify the work item.

---

## 5. State interim operator-visible behavior explicitly

Between slice 01 and 02, operators can select nodes that are not in the painted top window, with no scroll follow.

**Required outcome:** One explicit decision (or problem/tasks note) that this interim state is intentional: selectable-but-not-painted for off-window nodes until slice 02 wires scroll offset.

**Rationale:** Avoids treating a known gap as a spec bug and documents the bounded UX until the next slice.

---

## 6. Tighten problem statement and AC wording

- **Problem:** Cause is shared list between selectables and paint (post–slice-00: full flatten exists but both paths still use the same trimmed/sliced source). “Flatten or paint fitting” misstates the current bug after slice 00.
- **ACs:** Phrases like “every pipeline id” should match behavior: every **tree row id** from the full flatten (pipelines, stages, runs), not pipelines alone.

**Required outcome:** Problem text distinguishes current failure mode from the fix; overflow/retention ACs use vocabulary consistent with `monitorSelectableNodeIds` walking full flattened tree rows.

**Rationale:** Reduces implementer ambiguity without prescribing internal API shape.

---

## Not required (no refinement)

- Splitting the subspec (single `monitor-lines` + entry-pin seam, including right-pane outcome above).
- New ACs for ink, terminal-window, or `monitorTextLines` (behavior follows `monitorLeftPaneTreeRows` contract).
- Expanded-tree overflow fixtures (optional strengthener only).
- `v1-behaviors.md` in slice 01 (operator contract correctly deferred to slice 02).
- Separate AC for `setInvert*ForTest` (repo-wide convention).
- Viewport budget changes for unattributed/queue rows (pre-existing, out of scope).