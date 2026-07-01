## Verdict: required refinements

1. **Add `## Prerequisites`** citing merged scoped-abandon cleanup (`jarvis1 cleanup --abandon <worktree-name>`). Intent declares it; the subspec does not. Without it, implementers on stale branches can start work the command surface does not yet guarantee.

2. **Thread drill-down context into suggested-moves builders.** Named triage has `worktreeName` and `projectRoot` at `triageCommand`; `renderSuggestedMoves` today takes only `worktreePath`. Eligibility needs `projectRoot` (open-PR lookup, lock paths) and the operator-facing worktree name (scoped command text). The spec must require both fields reach `buildSuggestedMovesInput` / `renderSuggestedMoves`, and reconcile the decision ledger so it does not read as if `worktreeName` is derived from path.

3. **Define eligibility as the full scoped-abandon preflight composite**, not PR guards alone: worktree exists, no live lock (stale ignored), branch resolves, then `checkAbandonPrEligibility` outcome. Tasks and behavior text must require a single shared export consumed by cleanup and triage — rules out triage calling only the PR helper and drifting from what cleanup refuses.

4. **Record explicit decision: `clean + incomplete + prState ∈ {DRAFT, OPEN}` stays on fallback**, not rule 7. Cleanup may accept those shapes; triage must not suggest abandon while a draft/open PR implies an active resume channel. Rules out silent extension of rule 7 to all clean-incomplete eligible trees.

5. **Pin rule-table insertion order:** rule 7 after rule 6, before existing fallback (fallback remains the unmatched default). Rules out ambiguous precedence when reading the behavior section.

6. **Pin rule 6 discard-line operator copy:** keep `Discard:` prefix with scoped command, or adopt rule 7’s `Retire this worktree:` wording. Rules out inconsistent labels between rules 6 and 7 in acceptance criteria and docs.

7. **Add acceptance criterion + test for eligibility derivation**, not only preset `scopedAbandonEligible` booleans in rule-table tests. Must cover at least: eligible path, merged PR, ready open PR, multiple open PRs, live lock, PR inspection failure, branch resolution failure. Rules out green tests that never exercise the shared helper wiring.

8. **Strengthen preservation ACs** to cite pinning tests for rule 3 and fallback (`triage-command.test.ts`), alongside existing rules 1–5 citations. Spec guidance: preservation ACs anchor to tests, not paraphrased behavior.

9. **Expand documentation task** from a one-liner to a compact suggested-moves delta: eligibility gate, rule 6 discard substitution (resume retained), rule 7 predicate (`clean + incomplete + {CLOSED, none}`), explicit non-suggestion of global `cleanup --abandon`. `v2/docs/v1-behaviors.md` is the durable home per spec guidance; full `worktrees-and-commits.md` rewrite is not required.

10. **Add decision ledger entry** that rule 6 retains resume before abandon on dirty incomplete trees; triage does not suppress resume without an objective irreconcilable classifier. Closes intent deferral for dirty shapes without reopening resume-suppression scope.

**Not required (upheld defenses):** global abandon suggestion; `worktrees-and-commits.md` parity rewrite; changing unknown-`prState` git-teardown policy; abandon on `clean + DRAFT/OPEN + incomplete`; resume suppression on rule 6; untracked-only incomplete shapes.
