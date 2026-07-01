## Verdict

### Required refinements

1. **Pin standalone measurement procedure.** Replace ambiguous “isolated file run” with per-case measurement via filtered run (exact `test()` name). Marginal = total `test()` wall time (including inner loops), not per-iteration.

2. **Pin loaded-measurement role and bump trigger.** Loaded timing justifies `N` when an override is applied; it is not a second bump trigger independent of standalone marginality. Add a third closure path: standalone ≥ effective÷1.5 (~20s at 30s default), loaded within the 30s default, no `{ timeout: N }` — Outcome records both timings and explicit “no override” rationale. Resolves the AC/decision fork where marginal standalone cases neither qualify for “below threshold” nor clearly need `N > 30000`.

3. **Anchor Outcome to test-file state.** AC must require every Outcome bump to have a matching `{ timeout: N }` on that `test()` in `triage-command.test.ts`, and a zero-bump audit to state explicitly that no overrides were added. Outcome-only prose is insufficient closure (same gap as the classify spec’s missing patch Outcome).

4. **Carry intent prerequisite into subspec.** Add `## Prerequisites` or first checklist item: `--merge classifies all spec check statuses correctly` passes under `bun run test` on the implementation branch before audit work — do not assume a durable classify Outcome exists.

5. **Explicit eligibility exclusions.** Document in Decisions: synchronous unit-style tests in the describe with no poll/recovery wall time; `--merge with passing gate runs no recovery probes` (recovery helper wired but zero probe execution). Eligibility = poll config or recovery-probe execution paths, not generic `setupMergeWorktree` / fixture subprocess cost.

6. **Inventory closure rule.** Seed list is illustrative; Outcome must cover every `describe("--merge flag")` case matching eligibility after confirm (including renames), each with timings and one of: override applied, below marginal threshold, or marginal standalone with loaded within default.

7. **Standalone repeat policy for marginal cases.** When standalone ≥ marginal threshold, require ≥2 standalone samples or document single-sample caveat in Outcome.

8. **Blocker when gate is unstable.** If `bun run test` cannot complete at least one green loaded run during the audit, append `## Blocker` — no speculative overrides without a green full-suite pass.

9. **Outcome before AC ticks.** Task checklist must require appending **Outcome** (inventory, timings, bump table or none-needed rationale) before checking acceptance criteria.

10. **Pin “repeatable convention” for optional docs.** Convention worth documenting = ≥2 bumped cases sharing the same standalone÷1.5 headroom rule — rules out one-off override becoming durable guidance. Doc home remains `test/setup-fake-agents.ts` comment **or** `v1/docs/test-coverage.md`, not both.

11. **Preserve non-bumped eligible cases.** Extend preservation AC beyond classify: eligible cases without overrides pass `bun run test` with unchanged assertions (suite green alone is weak; name the eligible set or cite “all inventoried eligible cases without overrides”).

### Upheld without refinement

- Scope: one describe, one file, classify excluded, no harness/product/runtime changes.
- Bump mechanism: per-test `{ timeout: N }` with `N ≥ 30000` when override needed; no global default raise, serialization, or `sandbox-unrunnable`.
- Marginal trigger: standalone proximity to bound (~1.5×), not load-only proximity — matches intent; load-only flakes without marginal standalone stay out of scope.
- Preventive closure (inventory + green gate), not classify-style repro-before-fix.
- Monolithic subspec sizing for this intent.
- Documentation: none unless refinement #10’s repeatable convention emerges.
