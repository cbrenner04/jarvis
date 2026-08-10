## Verdict — refine before landing

The single subspec is correctly scoped (one module boundary, well under the reviewability threshold); no split. Six refinements are required, three of them blocking.

### Blocking

1. **AC4 cites tests that do not exercise what it claims.** `keeps command state unchanged in tree focus` never presses Enter (it presses `x q ← → backspace delete` plus a paste), and `submits only focused command input` presses Enter only under `focus: "command"`. Both run no-op control fakes that never mutate `state`, so their `toEqual(before)` assertions are vacuous with respect to selection and expansion. AC4 is the only carrier of the intent's "Enter on every non-attention row is inert" contract, and nothing currently pins it. Replace the citations with a *new* pinning test that selects a non-attention tree row in tree focus, presses Enter and Shift+Enter, and asserts no reveal occurs and selection/expansion are unchanged. Name its enclosing `test()` title in the criterion.

2. **The Enter-binding `@mutate` anchor collides with two pre-existing directives.** `v2/src/tui/tui-ink-monitor.test.tsx` already carries directives anchored on the exact strings `if (key.return && !key.shift) {` and `if (key.return && key.shift) return;`, each currently unique in `tui-ink-monitor.tsx`. A tree-focus branch written in the natural form duplicates the first string, making both directives multi-match — unparseable, and it blocks completion of this very spec (AC2 opens that file). The spec must require a distinct, unique anchor for the tree-focus guard and state as an acceptance outcome that the two pre-existing directives still resolve to exactly one occurrence.

3. **"Inert" is ambiguous about the observation point.** The Decisions place attention resolution inside the reveal control, so the key handler dispatches on *every* tree row and the no-op happens downstream. AC4 must define inert as *no selection or expansion change* (and no reveal of a target), not *no dispatch* — otherwise an implementer gates the key handler on attention selection, contradicting the Decisions and the AC2 spy contract.

### Required, non-blocking

4. **Name the steering-feedback side effect.** Routing through the existing selection path clears `steeringFeedback`. That is operator-visible and currently neither decided nor documented. Add it as a Decision (reveal inherits that clear rather than bypassing the path) and to the runbook doc updates.

5. **AC3 must cover the focus dimension and reuse the existing resolver.** Add a case pinning that with an attention row selected under command focus the dock shows the command hint, not the reveal hint — otherwise a future hint placed ahead of the command-focus early return goes unpinned. Also note in the task checklist that the hint condition reuses the existing attention-target resolution helper in `tui-monitor-lines.ts` rather than adding a third attention-row rebuild.

6. **Pin the deferred-case seam and tighten AC5.** Add one assertion in the AC1 test file that a target absent from the selectable set leaves selection unchanged — the Documentation updates already promise this as operator-visible behavior, and it is the exact boundary the sibling collapsed-member seed will move, so it should be a test, not prose. AC5 must name the enclosing test titles it depends on rather than describing them generically. Add one clause fixing the reveal hint atom's position among the other selection-conditional atoms.

### Not upheld

- The single-test-vs-split-tests structure is correct: the entry-level test drives a fake view host and never mounts the input hook, so a binding directive cannot redden it. Add one sentence recording that the intent's single-regression phrasing was restructured for this reason; do not add an end-to-end test.
- No hint-width/truncation criterion. The new atom is conditional and truncation-subject exactly like the existing ones; a width AC would import a contract the current hints do not carry.