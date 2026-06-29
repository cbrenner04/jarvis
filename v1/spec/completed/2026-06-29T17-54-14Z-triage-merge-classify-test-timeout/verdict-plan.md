## Verdict — required refinements

### Blocking (must fix before merge)

1. **Reconcile Problem with current effective per-test bound.** The draft frames failure as ~5.25s standalone against a ~5s cap. On current `main`, the suite bound is **30000ms** via `setDefaultTimeout(30000)` in preloaded `test/setup-fake-agents.ts` (not Bun’s nominal 5000ms or `bunfig.toml` alone). Problem must state the effective bound source and explain why the test still flakes under `bun test --parallel` at that bound—or whether the operator report reflects a pre-preload / isolated-run context.

2. **Do not ship `{ timeout: 15000 }` as a headroom increase.** Per-test `{ timeout: N }` overrides the default for that test only; under a 30s default, 15000ms **tightens** the cap and conflicts with intent (“raise … well above standalone runtime”). Decisions and tasks must choose fix direction from evidence, not copy the stale 5s narrative.

3. **Add repro-and-diagnosis before prescribing the fix.** Tasks must require reproducing under full-suite `bun test --parallel` (or an equivalent gate command), recording failure signature (Bun timeout vs assertion) and standalone vs loaded timing on current `main`. Without this, the spec cannot lock cause/fix alignment.

4. **Pin the fix fork after repro.** Decisions must rule among observable outcomes:
   - global 30s already suffices → verify and close (no harmful override);
   - parallel starvation pushes runtime past 30s → explicit override **above 30000ms** or wall-time reduction;
   - another mechanism → fix matched to recorded failure mode.  
   The draft must not jump straight to a timeout override without this fork.

### Significant (required for spec quality)

5. **Justify any per-test override value against the 30s default.** If an override remains, state why (e.g. measured loaded runtime, audit-trail pin against default regression) and how the chosen ms relates to effective bound—not intent’s obsolete 15000 example unless repro proves it.

6. **Rewrite preservation AC per spec guidance.** Replace paraphrased behavior claims with a citation anchor, e.g. `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` stays green with unchanged assertions.

7. **Align preservation AC with what the test actually asserts.** Pending cases only assert `pollCount >= 1` (comment allows merge or timeout). Do not claim “pending wait classification” or full twelve-status coverage beyond assertions. Either cite the test + “unchanged assertions” or list the three assertion classes (green merge, red refusal, pending poll ≥ 1).

8. **Clarify or merge redundant acceptance criteria.** `bun run test` already runs `bun test --parallel`; AC #1 and #4 overlap unless #1 means targeted/stress verification—state which.

9. **Resolve “reliably” vs verification depth.** Intent/AC say “passes reliably”; a single green gate run does not prove flake resistance. Either soften to “passes under full-suite parallel” (consistent with harness norms) or add an explicit repeat/stress verification task—do not leave “reliably” unbacked.

10. **Record timeout-config story in Decisions.** One line: effective bound = preload `setDefaultTimeout`; per-test override only when needed relative to that—not Bun default or `bunfig.toml` in isolation.

### Rationale (why these matter)

- Intent’s observable goal (test passes under parallel suite load) is sound; scope, workaround exclusions, and no durable docs are sound.
- Mechanism and remedy in the draft conflict with committed harness config and would likely be no-op or harmful—a pattern already flagged in prior deflake work.
- Downstream `triage-command-sibling-timeout-audit` lists this test passing reliably as a **Prerequisite**; wrong diagnosis here propagates.
- Spec guidance requires preservation ACs to cite pinning tests, not paraphrase behavior the author may misstate.
