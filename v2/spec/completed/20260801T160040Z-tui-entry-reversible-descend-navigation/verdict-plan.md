# Verdict: `tui-entry-reversible-descend-navigation`

**Status:** Refinement required before merge. Direction and serial ordering are sound; the spec must align acceptance criteria, prerequisites, and test contracts with the post–slice 01 baseline so failing-test and mutation requirements actually exercise slice 02’s net-new work.

---

## Required refinements

### 1. Sync prerequisites with the declared baseline

`intent.md`, the subspec **Prerequisites**, and any ready-intent artifact still describe FIFO-trimmed selectables and painted rows. After slice 00/01, the baseline is: full flatten drives `monitorSelectableNodeIds`; painted tree rows are a fixed top viewport slice; selection fallthrough to `ids[0]` (and backward equivalent) remains in entry navigation.

Update prerequisites to that handoff state. FIFO eviction may stay in **Problem** as cluster context, but must not appear in prerequisites or failing-test ACs as the thing being fixed.

### 2. Rewrite acceptance criteria #1–#3 for post–slice 01 / pre–slice 02

Several ACs describe FIFO-eviction symptoms that slice 01 already removes. Per spec guidance, each runtime-behavior AC must name a test that **fails against the merged slice 01 baseline** and passes after this slice.

Reframe ACs to target what slice 02 actually adds:

- **Reversible walk:** ordered forward `j` walk through list boundaries, then `k` back — backward visit order is the reverse of forward (not merely “visited more than one node” or set overlap). Define termination: stop when `selectNextRun` / `selectPreviousRun` leaves `selectedNodeId` unchanged, with a safety step cap.
- **Descend on first painted pipeline row:** pressing `j` on the top pipeline row in the initial painted slice selects its first child; does not jump to `ids[0]` via fallthrough. Replace “oldest visible pipeline” with unambiguous “first pipeline row in the initial painted tree slice.”
- **Membership after nav:** `selectedNodeId` remains in `monitorSelectableNodeIds` after each nav step — framed as consequence of removing fallthrough and correct descend behavior, not FIFO retention.

Each rewritten AC must retain “fails pre-fix” semantics against slice 01 merged, not today’s FIFO tree.

### 3. Add a monitor-lines failing-test AC

Tasks require scroll-offset unit coverage in monitor-lines, but no acceptance criterion covers it. Add an AC naming `tui-monitor-lines.test.ts` (or equivalent) asserting `leftPaneTreeScrollOffset` shifts painted tree rows without trimming `monitorSelectableNodeIds`; fails pre-fix.

### 4. Pin scroll-follow contract (#4) and scope

AC #4 (selected row in painted slice after off-viewport `j`/`k`) remains valid post–slice 01 and should stay. Clarify that scroll-follow applies to **tree rows** (`leftPaneTreeRowIds` / full-flatten index space); unattributed/queue rows below the tree are explicitly out of scope unless deferred to a follow-on.

Add a decision-level outcome for scroll-into-view: offset adjusts so the selected row’s index in the full flatten lies within the painted window `[offset, offset + maxVisibleRows)`, using minimal offset change (bring fully into view, not partial clip). Index space is full flatten, not painted-local.

### 5. Pin `indexOf === -1` behavior

Decisions say “clamp or no-op” but intent rules out `ids[0]` fallthrough. Specify outcome: **no-op** — keep `selectedNodeId`, reclamp scroll if applicable; no wrap to first or last list member. List-boundary clamping at ends stays unchanged.

### 6. Complete mutation / guard coverage

- AC #5 pluralizes “descend-navigation pins” but tasks checkpoint only the reversible-walk pin. Add a `Mutation checkpoint:` on the descend/first-painted-pipeline pin naming `ids[0]` (and backward fallthrough) reinstatement in `selectNextRun` / `selectPreviousRun`.
- Ensure membership invariant (AC #3) has an invert guard or is explicitly covered by the fallthrough checkpoint where appropriate.

### 7. Add documentation acceptance criteria

`v2/docs/v1-behaviors.md` and `v2/docs/operator-runbook.md` updates are listed under **Documentation updates** and tasks but not under **Acceptance criteria**. Add checkboxes per spec guidance so doc contract is agent-verifiable in-worktree (file content assertions or equivalent), not harness-only risk.

### 8. Clarify slice 01 test handoff in tasks

Tasks should state that overflow integration tests **extend** slice 01’s selected-in-paint contract — replace any requirement that every selectable appear in painted rows (slice 01 owns that inversion). Slice 02 owns selected-row scroll-follow only.

### 9. Optional but low-cost: `selectNode` scroll-follow

Decisions include `selectNode` as a scroll offset mutator; consider folding scroll-follow after off-pane `selectNode` into the viewport AC or tasks so mouse/keyboard pick matches `j`/`k`. Not a blocker if explicitly deferred with rationale.

---

## Rationale

- **Failing-test contract:** Spec guidance requires each behavior-changing AC to fail pre-implementation. ACs framed around FIFO eviction largely pass after slice 01, so an implementer could tick boxes without shipping scroll-follow or fallthrough removal.
- **Atomic verifiability:** The monitor-lines task without an AC leaves scroll state untested at completion.
- **Operator contract:** Scroll algorithm ambiguity and `-1` handling invite inconsistent implementations that satisfy prose but violate intent (surprise wraps, partial visibility, ink-only scroll).
- **Mutation guards:** Incomplete checkpoint coverage weakens regression detection for the core bug (fallthrough on descend).

## Not required

- **Subspec split:** Viewport state and entry navigation are one coupled, independently observable behavior (“`j`/`k` walk full selectables; pane scrolls to selection”). A split would land dead state or incomplete operator contract. Keep as a single subspec; add the missing monitor-lines AC instead of splitting.