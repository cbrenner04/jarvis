# Verdict: required refinements

## 1. Pin the left/right content partition (subspec 01)

The spec must state explicitly what renders in each pane and what is removed from the flat scroll:

- **Left:** run table rows and queue block via the grid builder (including how queue is presented—section vs folded rows).
- **Right:** workflow, outcome, and steering feedback only—the tail of today’s detail segments.
- **Dropped:** legacy flat header row (`runId project branch status liveness`), help/keybinding line (not relocated to the dock).

Without this, implementers must infer partition from code structure, which risks wrong splits and doc drift from operator-visible behavior.

## 2. Require region-local split-shell tests (subspec 01)

The split-shell acceptance criterion must require tests that prove **structural separation**, not merely that expected strings appear somewhere in the tree. Outcomes to pin:

- Detail content absent from the left subtree.
- Dock line 1 absent from left/right pane subtrees.
- Run rows absent from the right subtree.

This closes the gap where a flat layout could satisfy a weak global-string assertion while violating the intent’s split-pane shell.

## 3. Resolve fate of existing color and concatenation tests (subspec 01)

Preservation ACs cite only the three input-hook tests. The spec must address these existing tests that the shell change will touch:

- `colors status and liveness cells on run-table rows`
- `colors queue status and leaves admission descriptor uncolored`
- `concatenated rendered row cells match monitorTextLines entries`

Either cite them as preservation ACs (with adapted assertions where structure changes), or explicitly retire/replace the concatenation test in acceptance criteria. Silence leaves implementers without a contract for whether those tests stay green, get rewritten, or are removed.

## 4. Decide toned grid cells for `state` and `live` (subspec 01)

Subspec 00 correctly scopes to pure strings; subspec 01 must close whether ink preserves today’s `MonitorSegmentTone` coloring on `state` and `live` columns in grid rows. “Existing run rows as first consumers” implies preserving that operator signal unless documented as an intentional behavior change in `v1-behaviors.md`.

## 5. Add column-width map acceptance coverage (subspec 00)

Tasks require a width map matching the brief table, but ACs only pin truncation and empty-slot padding. Wrong per-column widths could pass. Add an AC that pins reference column widths (or total fixed row length at full width equals sum of visible column widths).

## 6. Promote row-builder degradation to acceptance criteria (subspec 00)

Degradation-tier cases live in tasks only; tasks are not completion gates. At least one AC must assert `buildMonitorTreeRow` omits dropped columns at a narrowed width (e.g., 72–89 drops `agent`/`id` while `state` and `elapsed` slots remain)—integration over `visibleColumns`, not re-proving the primitive.

## 7. Pin representative row-shape mapping (subspec 00)

Decisions describe collapsed vs workflow-child vs standalone mapping, but truncation ACs alone won’t catch indent/suffix swaps. Add one AC covering at least a workflow-child row (indent + role-in-label) and a collapsed/standalone row so the decision block is test-gated.

## 8. Specify refresh-interval plumbing to dock line 1 (subspec 01)

The decision names `createRefreshScheduler`’s `1s` default but not how that value reaches the dock. Clarify the contract (exported constant, deps field, session snapshot, etc.) so dock line 1 is testable without hard-coding or guessing.

## 9. Name terminal geometry injection for layout and divider tests (subspec 01)

Tasks thread `columns`/`rows` and session `dividerOffset`, but the test seam is unstated. Specify how tests supply terminal size (e.g., explicit deps or state fields) and that divider-nudge ACs use reference geometry (`245×72` or equivalent from prerequisites) so clamp behavior is reproducible.

## 10. State overflow behavior for pane content (subspec 01)

The brief’s scrollable tree is out of scope for slice 1; the spec should say explicitly that region overflow **clips** (or that scroll/scroll-into-view is deferred). Otherwise implementers may scope-creep into selection scrolling.

## 11. Align intent documentation with subspec 01 (intent.md)

- Add `v2/docs/test-writing.md` deferral trim to intent `## Documentation updates` (subspec 01 already requires it).
- Trim or annotate intent `## Prerequisites` so landed layout primitives read as confirmed foundation, not pending work.

## 12. Tighten operator-runbook doc AC (subspec 01)

The observation-table AC is loose (“describes the split-pane shell and dock”). Require the `jarvis tui` row (or adjacent prose) to mention: split-pane layout, 4-line dock, `[`/`]` divider nudge, and stacked fallback below 120 columns—enough that a one-line cosmetic edit cannot satisfy the criterion.

---

## Rationale summary

| Refinement | Why |
|---|---|
| 1, 4, 8, 10 | Behavioral specs must be implementable without code archaeology; operator-visible partition and signals must be explicit. |
| 2 | Failing-test AC must discriminate pre-fix flat scroll from real split regions (spec guidance). |
| 3, 4 | Refactor/preservation and coloring need cited tests or explicit retirement—not paraphrased assumptions. |
| 5–7 | Subspec 00 ACs under-test the row builder decisions that tasks describe but don’t gate. |
| 9 | Divider nudge ACs need a fixed geometry contract. |
| 11–12 | Intent/subspec and doc ACs must not drift; doc ACs must pin observable outcomes. |

## Not required

- **Subspec split:** Subspec 01 remains one atomic ink change—shell, real content, divider nudge, and docs are coupled by the intent’s “real content on day one” constraint. No independently testable split is mandated.
- **Stacked ink AC:** Optional polish; pure-layer stacked fallback is already landed. Add only if sub-120-column dogfooding is day-one critical.
- **`implement-queue.md`:** Housekeeping outside this spec’s scope.
- **`monitorSegmentRows` extraction:** Optional hardening; region-local ink tests are sufficient if refinement 2 lands.