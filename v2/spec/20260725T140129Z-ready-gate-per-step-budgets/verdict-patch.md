## Verdict — changes required before merge

### 1. The shipped budgets do not deliver the spec's model (blocking)

The armed timeout is `min(stepBudgetMs, ceilingMs − runElapsedMs)`. The second term is exactly the pre-fix value, and nothing in the repo sets `JARVIS_READY_TIMEOUT_MS`, so production always runs with the 10-minute `DEFAULT_TIMEOUT_MS` ceiling. Consequence: no step can ever be armed with *more* time than before this change — only the same or less. The intent's motivating trace still fails identically: a test flake at minute 5 arms the retry with `min(480000, 600000−300000)` = 5 minutes for a ~9-minute job.

Worse, `TEST_STEP_BUDGET_MS = 8 min` is *below* the ~9-minute aggregate suite duration cited in the spec's own problem statement, and below the ~13-minute full-gate figure recorded in `v2/docs/operator-runbook.md:878`. The subspec decision the AC was ticked against requires the aggregate test budget to **exceed** measured worst case with headroom; the constant's comment and `v2/docs/test-writing.md` both assert a measurement that appears nowhere in the branch. As shipped, this is a net tightening: a suite that passed at 9 minutes is now SIGTERM'd at 8.

**Required outcome:** per-step budgets and the run ceiling must be sized so the ceiling is a genuine backstop over the sum of plausible step budgets, not the binding constraint on any normal run — and the aggregate test-step budget must exceed an actually-observed worst-case suite duration with headroom. Cite the measurement (how and where obtained) in the constant's comment or the doc. Raising `DEFAULT_TIMEOUT_MS` is in scope: the spec rules out an *env-only* fix and requires the env *surface* stay unchanged; it does not freeze the default. Leaving a 10-minute ceiling above budgets that sum well past it is internally incoherent.

### 2. Flake-retry test proves the property only by an unrealistic clock delta

The retry test advances the injected clock by 60s for an attempt that costs ~8–9 minutes in production; both attempts show the full budget only because of that. It satisfies the AC as literally written but does not demonstrate the intended behavior. **Required outcome:** once the ceiling has real headroom, re-base the test on a realistic per-attempt delta so a fresh full budget on the retry is a real result, not an artifact of the fixture.

### 3. Doc statements that the code does not support

- `v2/docs/test-writing.md` claims the test-step budget carries "headroom for a `shared/**` diff that scopes to all three test slices." Each scoped slice is its own step with its own budget; three such budgets cannot fit under the ceiling anyway. **Required outcome:** state the sizing correctly — the unscoped aggregate `bun run test` is the worst-case *single* step; multi-slice scoping is N separate steps, and it is the **ceiling** that must cover their sum.
- `README.md:386` still describes ready as running "under a 10-minute wall clock (override with `JARVIS_READY_TIMEOUT_MS`)" — now false as a per-step description.
- `v2/docs/operator-runbook.md:410` still quotes the old literal kill message (`ready: deadline exceeded after Nms; killing child tree`), and the surrounding recovery guidance ("resume to re-run with more time") no longer holds for the step that actually times out, since per-step budgets are fixed constants. **Required outcome:** both durable docs updated in this subspec per `v2/docs/documentation-standard.md`, including naming the constant — not the env var — as the lever when a step budget is the binding limit. Do **not** add a per-step env knob; the subspec decided fixed constants.

### 4. Erased, not corrected, behavior in `v1-behaviors.md`

The bullet's sentence stating that scoped per-surface steps (`test:v1`, `test:v2`, …) do not get serial retry was deleted. That sentence was stale (scoped steps *do* get serial retry under the current `isTestStep`), so deletion isn't a fabrication — but the doc now silently omits a true, non-obvious fact, and this deletion was outside the authorized doc scope (which licensed replacing only the shared-deadline wording). **Required outcome:** restate the current truth — scoped test steps also get serial retry — rather than leaving a gap.

### 5. Ceiling regression test misses part of its own AC

The AC requires the ceiling kill to be attributed with step label **and allotted ms**; the test asserts the marker, `"run ceiling"`, and `"run typecheck"` but never the allotted `100ms`. **Required outcome:** assert the allotted ms. Also prefer a non-incidental assertion that the run stopped early over `not.toContain("run test")`.

### Not required

- Zero-remaining-ceiling short-circuit (currently a step is spawned and killed at ~0ms) — real but a hardening nicety outside the spec; acceptable as follow-up, fine to fix if already in the file.
- `"step"` attribution on exact `stepBudgetMs === ceilingRemainingMs` is correct as-is.
- `startsWith("test")` matching mirrors the file's existing `isTestStep` convention; no change needed. A stderr note when `DEFAULT_STEP_BUDGET_MS` is used for an unrecognized step is optional polish.
- The `clock` injection covering only `runReady` run-elapsed (not `runCommand` timers) is exactly what the subspec specified; conformant.

Re-verify with `bun run typecheck` and full `bun run test` (`scripts/**` is root tooling) after the changes, and only then leave the acceptance criteria ticked.