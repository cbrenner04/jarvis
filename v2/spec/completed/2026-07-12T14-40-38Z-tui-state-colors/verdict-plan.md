## Verdict — refinements required

The design is sound (segment model in the pure line builder, tone → color mapped at the ink boundary, one subspec). The gap is verification: four of seven acceptance criteria grade rendered ink cells, and nothing in the spec or the existing tests can observe them. Refine as follows.

1. **Give the rendered-cell criteria a verification path.** The current tests exercise `monitorTextLines` as strings; no test renders the ink tree. There is an existing seam for this (`loadInkUi(inkRender)` with a fake renderer, as used by the log-follow entry test). The spec must commit — in both the task checklist and the criteria — to a render-level test that asserts the `color` prop on the status and liveness cells. Do not resolve this by marking the criteria human-only.

2. **Stop claiming "byte-identical" unless something pins it.** The cited line tests assert substring containment on individual lines, not the full output array; a spacing or ordering regression would pass them. Either add a full-output pin (e.g. snapshot the `string[]` for a fixture state) and cite it, or drop the byte-identical claim and state the weaker guarantee the existing tests actually give.

3. **Decide and pin the whitespace/alignment contract.** Lines are currently one `Text` with single-space joins. Splitting a row into sibling cells drops those separators unless they are emitted explicitly. This is the one visible regression the change can introduce; the spec is silent on it. Add a decision (separators are part of the segment model) and an acceptance criterion that row text renders identically to today.

4. **Give the composing/`Revise prompt:` line a home in the segment model.** It is appended to the string array by the ink monitor after `monitorTextLines` returns. If the monitor now consumes segments, state what that append becomes (an untoned segment row) — otherwise the "single source of truth" decision is defeated at the exact seam it exists to protect.

5. **Make the exhaustiveness criterion checkable.** "Adding a status without extending the mapping fails typecheck" is not a runnable check. Restate it as structure plus a test: the tone map is total over `RunStatus` with no default arm, and a unit test asserts every member of `RUN_STATUSES` resolves to a tone. That remains typecheck-enforcing while being verifiable today.

6. **Replace the circular rationale for the failure-tone grouping.** "A fourth neutral tone is ruled out because the intent names three semantics" restates the constraint rather than defending the grouping. The defensible line is terminality: `blocked` and `budget-soft-stopped` are terminal — the run has stopped and will not resume from this screen — which places them with `failed`/`killed`, while `awaiting-human` is a live run pausing for input the TUI itself accepts. State that.

7. **Resolve the outcome-panel inconsistency explicitly.** As drafted, the same run's status is green in the table and uncolored in the `runStatus:` panel below it. Either extend the tone there or give the exclusion a stated reason (the panel is key/value diagnostics, not the at-a-glance state table). Silent exclusion reads as a bug.

8. **Tighten the `v1-behaviors.md` documentation bullet** to say the entry follows that file's conventions for v2-additive TUI behavior (tag and source citation), not just that the file is touched.

No split required — this is one implementation path and one reviewable change. The palette pin stands: this spec introduces the first consumer, so pinning satisfies the intent's deferral rather than overriding it.