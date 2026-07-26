# Adjudicator verdict — per-step ready-gate budgets

## Required refinements

1. **Merge-order prerequisite on the routed spec**  
   The subspec (or `index.md`) must state that implementation assumes merged `gate-timeout-is-not-a-red-gate` (124 gate exits treated as retryable infrastructure, not repairable red gate). Intent-only prerequisites do not survive for implement agents.

2. **`runCommandFn` / timeout seam contract**  
   The spec must define what orchestration tests observe when recording “armed” timeout: the value passed into the command runner after `min(stepBudget, ceiling − runElapsed)` is applied in `runReady`, not raw ceiling or ad hoc mock math. Without this, mocks can duplicate production logic and pass with wrong wiring.

3. **Per-step isolation acceptance scenario**  
   Rewrite the “later step gets full budget after prior step exhausts its own” criterion so it matches real `runReady` behavior (a step that hits its budget exits the run; the bug is shrunk **armed** timeouts for later steps when **run elapsed** is large, not necessarily a prior kill). The spec must require a reproducible way to advance run elapsed in agent-runnable tests (injectable clock / elapsed override, or an explicitly scoped delay in orchestration mocks only)—consistent with the no–wall-clock-sleep rule for spawn-boundary tests.

4. **Spawn / stderr acceptance for both kill kinds**  
   Extend deadline-kill criteria so automated checks cover **step budget** vs **run ceiling** attribution (which bound limited the armed timeout), plus step label and allotted ms—not only exit 124 and a generic message. Require distinct scenarios (or equivalent parameterized cases): step budget binds with ceiling headroom, and ceiling binds with step budget headroom.

5. **Preservation acceptance criteria as test citations**  
   Replace paraphrased “stay green” bullets with refactor-style citations: named tests in `ready-finalize.test.ts` for `DEADLINE_KILL_MARKER` / 124 classification, and the existing test that 124 on the test step does not trigger serial retry in `ready-script.sandbox-unrunnable.test.ts`.

6. **Guard-inversion meta-criterion**  
   Drop the standalone “inverting guards fails tests” bullet or mark it human-only. Per-guard behavior is already implied by the ceiling and flake-retry tests; CI cannot enforce manual mutation.

7. **Ceiling test and budget constants**  
   State that the ceiling regression must be able to assert correct attribution and timing without re-implementing budget resolution in tests—e.g. by exporting step budgets or a shared resolver/constants test hook if values stay module-private.

8. **Documentation outcome for sizing (intent alignment)**  
   Task or acceptance for `v2/docs/test-writing.md` must require a **concrete** aggregate test-step budget (ms) and scope (full suite / `shared/**` → all three slices, operator hardware), plus that per-step budgets apply inside `bun run ready` with `JARVIS_READY_TIMEOUT_MS` as run ceiling only. Intent’s “measured worst-case + headroom” is not automatable as a wall-clock unit test; docs (and optionally a colocated constant comment) are the enforceable contract unless a non-flaky guard is added later.

## Optional clarifications (not blocking merge of spec quality)

- One sentence tying ready budgets to write-loop **shape** (`iterationTimeoutMs` / ceiling analogue) while keeping fixed per-step constants and no daemon `iterationTimeoutMs` wiring.  
- Cross-link or note in `operator-runbook.md` for attributed kills.  
- Process note in docs for updating constants when suite duration drifts.

## Rationale (summary)

Intent and subspec agree on the core model (`min(stepBudget, ceiling − runElapsed)`, fresh flake-retry budget, 124 + marker, single `ready.ts` surface). Gaps are **testability of run elapsed**, **seam contract for orchestration mocks**, **complete kill-message contract**, **spec-guidance preservation citations**, and **surviving prerequisite + doc sizing**—not a split of the subspec or extra tier/scoped-step ACs.

## Upheld without change

Single atomic subspec; full `bun run test` for `scripts/**`; no env-only sizing fix; parent `execFileSync` / suite-speed out of scope; fast tier and install covered by one loop and constant sizing.