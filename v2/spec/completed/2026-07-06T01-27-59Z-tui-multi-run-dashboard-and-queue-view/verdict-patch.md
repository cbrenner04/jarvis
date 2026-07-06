## Verdict

No required outcomes. All acceptance criteria in `00-queue-view-section.md` are satisfied.

Rationale on the three points raised:

1. **Selection not auto-restored when a queued run promotes to active while nothing is selected** is a real behavior, but it's a pre-existing property of `refreshRuns` (it never re-derives a selection from a `null` state for any reason) and not something this subspec's decisions or acceptance criteria address. The spec's selection-related criteria are limited to (a) initial-connect selection and (b) fallback-on-disappearance never choosing a queued run — both correctly implemented. Expanding scope to "auto-select on promotion" would be new work beyond what was decided; defer to a follow-up subspec if it becomes an operator pain point.

2. **FIFO-ordering coupling to daemon list-ordering assumptions** is a deliberate, spec-sanctioned decision (explicitly called out in the Decisions section), documented inline in the implementation, and covered by a direct test asserting the ordering. Not a gap.

3. **Missing column header on the Queue section** is a minor cosmetic inconsistency with the Runs section's header row, but no acceptance criterion or spec decision requires a Queue header — the spec only pins per-row fields. Not required for this subspec; acceptable as optional follow-up polish, not a blocking defect.