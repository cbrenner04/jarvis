Checking the brief and related docs so the verdict matches the actual contracts.
## Verdict: required refinements

1. **Make divider geometry derivable beyond a single pin**
   - Decisions must state how left/right widths are computed from `(columns, rows, dividerOffset)`: default 38/62 split, rounding rule (so 245→94), how `dividerOffset` applies, and clamp to floor 72 / ceiling 40% of width.
   - Acceptance criteria must include at least one additional geometry pin at a non-reference width (or equivalent) so implementations cannot pass on the 245×72 case alone while diverging elsewhere.

2. **Tighten column-degradation acceptance criteria to match the brief table**
   - Current AC language only names `state` and `elapsed`; that is weaker than the linked brief contract.
   - ACs must assert per-tier visible column id lists (and order) for all five width bands (≥90, 72–89, 58–71, 48–57, <48), importing the full degradation table—not a subset.
   - Add boundary pins at widths 90, 72, 58, and 48 (e.g. 90 vs 89) so off-by-one tier bugs fail.

3. **Resolve “unpopulated columns reserve slots” with a testable outcome or explicit deferral**
   - The decision is stated but has no verification path; green tests could violate the brief’s fixed-width grid.
   - Either: add an AC that empty cells still consume their defined column widths in a pure row-formatting surface, **or** explicitly defer slot reservation to the ink-shell sibling (mirroring the stacked-dimension deferral) and soften/remove the untestable decision until then.
   - Leaving the decision in place without one of these is not acceptable.

4. **Restore prerequisites on the implementable subspec**
   - Copy the two `intent.md` prerequisite bullets into the subspec: brief documents region geometry and degradation table; TUI keybinding tests pin via injected input without ink-frame assertions (#2418).

5. **Clarify stacked-mode scope for column degradation**
   - Add a decision that `visibleColumns` (or equivalent) is not defined/called for stacked layout until the ink shell pins stacked tree width—degradation tests remain side-by-side only.
   - Pin the 120-column boundary explicitly: width 119 → stacked, width 120 → side-by-side (or named complement).

6. **Name the non-stacked layout mode**
   - `layoutMode: "stacked"` is pinned; name the complement (`split` or `sideBySide`) in Decisions so types and tests do not diverge.

7. **Pin truncation semantics beyond overflow-only**
   - Add an exact-fit case (no ellipsis when text fits).
   - State that width is measured in code units (repo convention), not terminal display width.

8. **Strengthen the `test-writing.md` documentation outcome**
   - Beyond naming substitutes, the section must record: CI cannot observe painted ink (#2417/#2418); asserting on rendered frames risks local-green/CI-red asymmetry.
   - Cross-link `operator-runbook.md` § Gate trust and note that full runbook wording updates are owned by the ink-shell sibling (traceability for the folded seed, not scope creep into slice 1).

**Rationale:** Items 1–3 close gaps where passing tests could still miss brief contracts—violating spec guidance’s failing-test and guard-inversion intent. Items 4–8 remove implementer ambiguity and align the subspec with `intent.md`, the brief, and serial ownership with `tui-command-center-ink-shell`.

**Not required:** Splitting the subspec; ink-shell formatter integration; runbook/seed deletion in slice 1; fail-fast lint; renaming nudge AC keybinding wording; syncing `intent.md` guard-inversion ACs; general geometry invariant tests beyond the above.