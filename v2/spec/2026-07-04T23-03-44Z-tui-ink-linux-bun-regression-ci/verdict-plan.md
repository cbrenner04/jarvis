## Verdict: Required refinements

1. **Evidence the guard is real.** Add a decision or AC line citing the fix commit/PR that introduced `loadInkUi()`'s Yoga-TDZ assertion, establishing that the smoke test actually fails without the fix. Without this, "regression guard" is asserted, not shown.

2. **`test:integration:v2` coverage gap.** State explicitly whether `test:integration:v2` uses the same `walkV2TestFiles` walker (fix covers it for free) or a separate one (untouched gap, needs its own line item). AGENTS.md requires both scripts run on `v2/**` changes — silence on this is a real gap, not a style nit.

3. **Blast radius of the three newly-swept-in files.** Add an AC confirming `tui-log-follow-entry.test.tsx` and `tui-entry.test.tsx` (not just `tui-field-collector.test.tsx`) pass under `test:v2` today, so the glob widening doesn't surface pre-existing failures as a side effect.

4. **Tighten or cut AC #3.** As written it restates ACs #1–#2 without adding independently checkable verification and can't be confirmed without a real CI run. Either rework it into something locally verifiable (e.g., feeding a `v2/**`-only diff through `ci-test-scope.ts`'s own test suite) or remove it.

5. **Confirm CI runs on Linux/Bun.** Add a one-line citation to the actual workflow file/job showing `test:v2` executes on a Linux runner under Bun — the intent's title makes this a load-bearing claim, not an assumption.

Minor, optional polish (not blocking): a one-line note on what `loadInkUi()` asserts, and an explicit note that `bun test` is headless/PTY-free (supports the hermeticity decision already stated in the intent). No structural change to the subspec's scope or count is required.