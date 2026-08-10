## Verdict

Refinement required. The following must be addressed before this spec is implementable.

### Blocking

1. **Publication-failure age contradicts the spec's own no-fabrication rule.** `00` sources terminal-publication-failure `sinceMs` from the pipeline's `finishedAtMs`, but that value degrades to the pipeline's `createdAt` when no stage carries a durable terminal timestamp. That is exactly the "never fabricate an age from creation time" case the intent rules out. `00` must derive publication-failure age from a genuinely durable terminal signal and yield `null` when none exists, with an acceptance criterion pinning the degenerate case.

2. **Elided placeholder stages would pin rows that point at nothing.** The tree model drops post-split placeholder stages from its node set. A failed or blocked placeholder would produce an attention row whose target node id matches no tree node and no right-pane detail. `00` must state that stages absent from the tree model do not pin, and carry a negative-case criterion. This also honors the intent's "rules out pinning skipped placeholders," which was lost in translation.

3. **"Gate" is never defined.** Gate-vs-failure decides both glyph and sort group, and `00` states no rule. It must define what qualifies (approval-kind stage in an awaiting/rejected state), and confirm that determination stays inside the declared pure `(snapshots, run rows)` projection.

4. **The stage↔run join is left to be reinvented.** Attributing runs to stages (including workflow collapse) already exists in the tree model; a standalone re-derivation in the projection will diverge silently. `00` must decide to source rows from the existing pipeline tree node model — which is itself a pure function of snapshots and run rows — rather than raw stage records, so elision, the invocation join, and node-id derivation are shared rather than duplicated. Additionally, `where` for a pipeline-attributed run that pins while its stage does not is currently undefined and needs a decision.

5. **Attention-target detail resolution needs a decision on tree side effects, not just state.** Right-pane detail already resolves against the full tree and already auto-expands ancestors of the *selected* node. A naive dereference of `attention:<targetNodeId>` therefore makes the painted tree reveal the target's ancestors while `expandedPipelineNodeIds` stays untouched — so the "reveals no ancestors" decision would be violated while its acceptance criterion still passes. The spec must pick one behavior explicitly (reveal, or suppress ancestor resolution for attention selections) and pin it with a criterion that observes painted rows, not just stored state.

6. **`01` is oversized and must split.** Paint plus selectable order is one change to the left-pane model; attention-target right-pane resolution is a separate code region, a separate pinning surface, and the only part that alters existing detail behavior. Split into `01` (segment paint, segment height budget, selectable order, initial selection, overflow unselectable) and `02` (attention-target detail resolution and its tree-side-effect decision from item 5). Every decision and acceptance outcome currently in `01` must appear exactly once across the two, each with its own failing-test and keystone criteria, both linked from `index.md`.

### Cheap, must land

7. **Equal-`sinceMs` rows have no tiebreak.** Fan-out stages settle in the same millisecond routinely, so dated ordering is currently nondeterministic. Add target node id as the secondary key for dated rows, matching the undated rule.

8. **The cap can starve the tree to zero rows.** Heading plus six rows plus overflow exceeds the left pane's row budget on a short terminal. `01` needs a decision bounding segment height against pane height (a minimum tree budget) and a small-terminal acceptance criterion.

9. **Selection marking inside the segment is unspecified.** Tree rows carry a selection marker; the attention segment states none. Combined with the no-ancestor-reveal decision, a selected pin could show no marker anywhere. State that the attention row renders the marker itself.

10. **Heading text is unspecified.** Name the literal string.

11. **The cap-boundary ordering outcome is untested.** No criterion asserts a gate row takes a cap slot over an older failure — the intent's stated rationale for gates-before-failures. Add it.

### Record only (one clause each, no new criteria)

12. **Steering feedback codes.** `01` names the dock refusal consequence but not the codes; name the existing refusal for log-follow alongside kill and approve/reject, since attention-first initial selection makes these the operator's default-state responses.

13. **Pins are read-only.** Deferring action to the interaction surface is a legitimate intent decision, but an operator who selects a pinned gate must still walk into the tree to approve it — most of the segment's purpose. Record the resulting operator loop in `01` and name a successor intent.

14. **`✗` for `blocked`.** Blocked runs retain a worktree and are resumable, so sharing the failure glyph needs one line of justification or a distinct glyph.

15. **Cap scope across daemons.** The projection sees merged snapshots, so the six-row cap is global rather than per-daemon. One clarifying clause in `00`; id collision is an existing tree-level assumption and needs nothing.

### Rationale

Items 1–4 are internal contradictions or undefined behavior in the projection — the spec grades outcomes it does not actually determine, and item 4 sets up divergence from the tree model that gets expensive after landing. Item 5 is a criterion that passes while its own decision is violated, which the guidance treats as an unfalsifiable acceptance surface. Item 6 follows the atomic-subspec rule: the detail-resolution change is independently testable and touches existing behavior, so it earns its own reviewable unit. Items 7–11 are unspecified outputs that an implementer would otherwise invent.