## Verdict — changes required

### 1. Branch idle must key off actual branch execution, not the summary stage status

Branch work/idle currently suppresses idle when the branch's *summary* stage status is the literal string `"running"`. The summary is "first unsatisfied record," so a branch whose summary record is `failed`/`rejected`/`awaiting` while a later record is genuinely `running` shows work advancing *and* idle advancing simultaneously — the exact "idle masquerading as operator wait while work advances" failure the plan verdict forbade. Required outcome: a branch hides idle exactly when any of its member records is in active execution, and shows work plus idle otherwise; pipeline and branch must not share an untyped `state: string` channel that silently accepts two different status vocabularies. Add a regression pinning the failed-summary-with-running-later-stage case.

### 2. The compact timing cell must actually fit its column, or the docs must stop claiming it does

`formatTreeTiming` pads but never truncates. Realistic values (`w59m/i10d`, `w23h/i100d`) exceed eight columns, so the compact cell overflows and the documented "eight-column" contract is false. Existing width coverage only pins a 7-character value. Required outcome: the compact form is bounded by its column for multi-digit/multi-day values (or the docs state the real bound), with coverage on a value that would otherwise overflow.

### 3. The width tier must be stated honestly and tested at the width that actually paints

The `<100` threshold is applied to *pane* width, not terminal columns; the left pane is clamped to roughly 38–40% of terminal width, so the labeled `work … · idle …` form requires a ~250-column terminal and never appears on ordinary ones. That is a legitimate reading of the subspec, so do not retune the threshold here — but two things are wrong and must be fixed: (a) both doc paragraphs say "at 100 columns or more" without saying which width, and must name pane width explicitly; (b) the end-to-end display-tick test hard-codes a width of `120` while the fixture's real pane width is ~94, so the one integration-level assertion of the labeled form asserts a configuration the TUI would never paint. That test must derive its width from the computed layout. Surface the practical unreachability of the labeled form as a decision for follow-up rather than changing it.

### 4. "Never silently drops work" must be true or must not be claimed

The timing atom is droppable and rightmost, so cluster degradation removes it entirely before any compact-form fallback — and the new padded 20-/8-column atom is materially wider than the elapsed atom it replaced, making that drop more likely. Required outcome: either the timing atom survives degradation down to the non-droppable status, or the runbook/behaviors text is narrowed to say the no-drop guarantee holds only within the rendered timing string.

### 5. Restore and complete the documentation the change displaced

- The runbook table row dropped the stage-level statement that elapsed freezes only when the recorded end timestamp is present, replacing it with run/ad-hoc prose. Restore an accurate stage-freeze statement.
- `v1-behaviors.md` still describes the branch summary as derived from "first post-split record" as though unchanged, but branch summary records now include gate records that the tree elides. Document that a `pending` gate can now become a branch's summary, and add a test pinning it. (The record-set change itself is correct — it is what makes pipeline work equal pre-split plus the sum of branch work — so keep it.)

### 6. Add the aggregate invariant and terminal-pipeline coverage that was lost

The refactor deleted the terminal-pipeline assertions from the tree-row freeze test and nothing replaced them. Required outcome: (a) a two-clock assertion on a terminal pipeline's tree row showing work frozen while idle advances; (b) a test pinning that pipeline work equals pre-split work plus the sum of branch work — this is the invariant the record-set and placeholder-handling changes both turn on and is currently unprotected.

### 7. Make sub-second terminal group elapsed consistent

A terminal group finishing under a second after admission renders blank, while a finishless one renders `0s`. Required outcome: terminal run/ad-hoc rows render a consistent zero value in both cases.

### Explicitly not required

- Placeholder `default` records entering the pipeline work sum: unreachable in practice (`startedAt` stays null on skip), and their skip `endedAt` is a real split-time event that cannot inflate idle. A short comment noting the intentional inclusion is enough.
- Dropping the whole interval when `endedAt` is slightly ahead of the display clock: a defensible literal reading of "future intervals clamp to zero." Do not change it here; note it as a follow-up decision (clock skew between daemon and TUI makes it routine).
- The mutation-directive-shaped identifiers: the acceptance criteria pin those exact tokens.

### Optional (style, no behavior change)

Passing `compact` as an argument rather than spreading it onto a copy of the pipeline node — the current shape welds a render concern onto a model type and allocates per row per display tick — and having the tree-only failed-before-start label delegate to the shared stage label rather than duplicating the predicate. Both mutation directives still bind after either change.