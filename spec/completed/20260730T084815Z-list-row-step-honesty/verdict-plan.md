Reviewing the spec draft and key code references to ground the verdict.
## Verdict: required refinements

### Intent (`intent.md`)

1. **Narrow the no-`pending` decision to entry rollup `completed`.** Intent says any terminal run must not report `pending`; subspec 00 correctly limits the rule to `completed` rollups and preserves early-stop later-step `pending` via a pinned test. Intent must match that scope so implementers do not broaden or contradict the stopped-before-last-step contract.

2. **Fix stale code references and field naming.** Line citations point at the wrong durable-step path and an outdated `runListFinishedAtMs` location; the wire field is `attemptCount`, not `attempts`. Cosmetic but avoids implementer drift.

### Subspec 00 — scope and decisions

3. **Resolve early-stop terminal rollups with cleared review progress.** Early-stop “keep later unstarted steps `pending`” does not cover a review step that invoked an agent and then lost in-memory progress on a `killed`/`failed` rollup (same fall-through as the `completed` bug). Either extend reconciliation/freeze to all terminal rollups for steps that had reported progress, or add an explicit out-of-scope note. Leaving it unmentioned ships a partial fix for the honesty theme.

4. **Clarify live vs terminal `attemptCount` semantics.** Decision prose says any step that invoked an agent reports `>= 1`, including “live or settled progress,” but existing list tests expect `attemptCount: 0` for `in_progress` review. Pin one contract: either terminal/settled-only `>= 1` (narrow the decision) or live `>= 1` (update expectations and cite those tests as preservation or change targets).

5. **State freeze-before-guard precedence.** Decisions call for freezing terminal progress at the completion boundary and also a completed-rollup guard when progress is cleared. The spec must say which mechanism is primary and what the guard backstops, so rollup-only reconciliation does not produce non-`pending` but hollow steps.

6. **Pin terminal field retention beyond `attemptCount`.** If progress is cleared after a terminal review step was reported, reconciled steps should retain `role` and `terminalOutcome` (extend the existing terminal review list test or add AC coverage). Absent this, freeze can be skipped while ACs on `pending` and `attemptCount` still pass.

7. **Name the cleared-progress regression test in its AC.** Spec guidance requires failing-test ACs to name verifiable tests; “adds coverage where…” is insufficient alongside guard-inversion ACs.

8. **Add explicit in-process scope for non-durable review.** In-memory progress does not survive daemon restart; rollup guard can suppress `pending` post-restart but cannot recover counts or role/outcome without persistence. Document that cross-restart honesty for non-durable review is out of scope unless a future persistence spec owns it.

9. **Strengthen preservation pinning.** Cite `list retains durable plan debate rows across live, terminal, and restart projection` (durable `attemptCount` from `run.attempts.length`) alongside the early-stop pending test. Ties durable vs non-durable sourcing to named regressions.

10. **Align task checklist with AC verification surface.** Task optionally names `workflow-list-snapshot.test.ts` but all ACs are integration-only; drop the optional unit-test task or add an AC if unit projection tests are required. Integration-only is sufficient if tasks match.

11. **Name the rollup signal in tasks.** Replace “or equivalent terminal/completed signal” with entry rollup `reportedStatus` (or the concrete daemon field) so projection threading is unambiguous for entry vs sibling rows.

### Subspec 01 — prerequisites and ordering

12. **Add a `## Prerequisites` section** declaring dependency on store terminal reconciliation recording `reconciledAt` on killed/interrupted runs (referenced store spec). Without it, implement-before-store risks ACs that assume behavior the store does not yet provide.

13. **Document serial implement order in `index.md` or subspec 01.** Subspec 01 lands after store timestamps; downstream `terminal-window-renders-finishless-rows` depends on subspec 01. Intent prerequisite covers store → this spec but not the chain within this tree.

14. **Qualify operator-runbook documentation vs sibling TUI work.** Runbook update claims TUI terminal-window finish sourcing from reconciliation while finishless-row policy is deferred to a sibling. Docs must distinguish list providing `finishedAtMs` from TUI consumption until the sibling lands, or defer the runbook bullet to that sibling.

15. **Optional but recommended:** cite an existing list test that asserts `finishedAtMs` from attempt `completed_at` as a preservation AC (refactor AC pattern), so attempt-only rows are pinned by name rather than only via `bun run test:v2`.

### Subspec 00 — split

16. **No split required.** Three paths share one daemon list-projection seam and one implement PR is coherent. Refinements above (especially items 3–6 and 4) close the partial-completion gaps that made bundling weak; splitting is optional only if refinements cannot reconcile live `attemptCount` and early-stop cleared-progress scope in one subspec.

---

### Rationale (summary)

Intent and subspec 00 diverge on “terminal” vs `completed` rollup — the cited failure is completed-specific and early-stop pending is contractually pinned. Unaddressed early-stop + cleared-progress and live `attemptCount` ambiguity let implementers satisfy AC subsets without delivering the intent’s honesty goals. Prerequisite and ordering gaps risk implement-before-store and doc-ahead-of-TUI for subspec 01. Named tests, preservation citations, and scope notes align with spec guidance on failing-test ACs, refactor pinning, and merge-first serial sibling order.