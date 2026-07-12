## Verdict — refinement required

### Upheld

**1. The keypress layer is untestable, and the spec's ACs cite tests that don't exist.**
`loadInkUi` only returns `useInput` on the real `ink` import path; the injected-render path used by tests returns no `useInput`, and `tui-ink-monitor.tsx` degrades to a no-op handler. There is no `tui-ink-monitor` test file today. So the AC "`tui-ink-monitor` … steering tests stay green" cites a suite that does not exist, and the keypress-behavior ACs (down/up moves selection, no-op while composing, no-selection recovery) cannot be verified at all under the current seam.

Required: make key handling injectable and pin today's bindings as its own subspec, then layer navigation on top. Two subspecs linked from `index.md`:
- **Seam + pinning** — key handling reachable from tests with an injected input handler; existing `q`/`a`/`v`/`k`/revise-compose bindings pinned by new tests with zero behavior change. This is what makes the current spec's preservation ACs real rather than aspirational.
- **Navigation** — the movement behavior, whose ACs may then legitimately cite the tests the first subspec creates.

Every task and acceptance outcome from the current draft must appear exactly once across the two files; do not drop the compose-inert or preservation criteria in the split.

**2. Display order is derived twice.**
`monitorTextLines` computes the rendered row order (non-queued filter for the table, reversed queued subset). Navigation implemented separately in `tui-entry.tsx` would re-derive that order with nothing tying the two together. The pending `tui-active-runs-first` intent regroups selectable rows into active-then-terminal — when it lands against a duplicated filter, `j` walks an order the operator cannot see. The spec must require one shared selectable-rows-in-display-order source used by both rendering and navigation, and an acceptance criterion that verifies movement against the *rendered* order, not a re-derived one.

**3. Cursor anchoring is unstated.**
`refreshRuns` already preserves `selectedRunId` by id, so the draft's "a refresh that reorders rows keeps the same run selected" is tickable today with no code — it grades nothing. Decide and record whether the cursor is id-anchored (position recomputed from the current row list on each keypress) or a stored index, and give the reorder criterion teeth: after rows reorder, the next movement key steps relative to the selected run's *new* position.

**4. Documentation surface is incomplete.**
`v2/docs/write-behavior.md` currently states that row-navigation keybindings "are not wired yet" and that production keybindings are deferred — this spec falsifies both. `v2/docs/v2-architecture.md` enumerates the bound key vocabulary and the rationale for what is and isn't bound; a new global `j`/arrow binding belongs there. Both must join Documentation updates alongside the walkthrough.

**5. Two small decisions the spec passes over silently.**
- Holding a movement key fans out `wait` calls: each `setSelection` bumps the wait token and starts a new subscription, with stale responses abandoned client-side rather than cancelled. Navigation doesn't create this property but makes it trivial to trigger. Accepting it unbounded is defensible — the spec must say so as a ledger entry naming what it rules out (debounce, cancellation), rather than leave it unaddressed.
- `selectRun` on `TuiMonitorControls` stays (view-host tests drive selection through it, unbound in production) — state that in one line so a reader doesn't remove it as dead.
- In-app discoverability: the footer currently renders only `Press q or Ctrl-C to quit.` and is snapshot-tested. Decide explicitly whether the new keys appear there or only in the walkthrough; either answer is fine, but silence leaves keys the operator can only learn from a markdown file.

### Not upheld

The `j`-without-vi-up asymmetry needs no separate decision — it follows from the recorded rejection of `k` for up. Optionally tighten that entry to also rule out remapping kill to free `k`.

### Retained

The core design survives review: clamp rather than wrap, skip queued rows, route movement through the existing `setSelection` path, inert while composing, arrows plus `j`. Do not relitigate these.