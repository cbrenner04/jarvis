## Verdict

Four issues require the actuator to address before this spec is complete.

---

**1. `clearDelta` not called on clean completion when spec is external and `gitEnabled` is true — must fix.**

Both `clearDelta` callsites in `iteration.ts` are gated on `!gitEnabled`. When a spec is external and `gitEnabled` is true, neither callsite fires. The delta persists on disk after a clean completion. The next re-run loads the stale delta and un-ticks ACs that were legitimately completed — the opposite of the intended behavior and a direct violation of AC "in-repo spec run under `git:true` triggers no delta reset." The `clearDelta` condition must cover the external-spec case. This is the most severe bug.

**2. `hasUntrackedMutations` and `trackSourceSpecDelta` predicates are mismatched — must fix.**

`hasUntrackedMutations` records a delta for any path outside the agent working tree (broad). `trackSourceSpecDelta` (which gates the reset) applies only to `~/.jarvis/specs/<proj>/` paths (narrow). An external spec that is not in the jarvis-managed directory accumulates delta files that are never consumed or cleared. The spec's Decisions section states externality should be detected with the same predicate as preflight; the implementation must align these two predicates so every path that records a delta is also covered by the reset (and `clearDelta`), or vice versa — no orphan delta files.

**3. New test does not exercise the `gitEnabled:true` branch — must fix.**

The new test in `no-commit-delta.test.ts` calls delta module functions directly, bypassing `iteration.ts`. It never evaluates the `hasUntrackedMutations = !gitEnabled || specIsExternal` gate. AC 6 explicitly requires "A new test exercises an external spec path resolved outside the agent working tree with `gitEnabled` true." That test must reach the gate in `iteration.ts` and verify the correct behavior end-to-end, not just the underlying delta module in isolation. This gap also means Finding 1's regression would survive the test suite.

**4. Combination blocker case has a latent data-loss bug — should fix.**

When a spec has a pre-existing `## Blocker` and the run appends a new one, `applyReset` calls `stripBlockerSection`, which removes the entire section including the pre-existing content. No test covers this. The reset must preserve any pre-existing blocker text that predates the run. A test should assert this invariant explicitly.

---

**No other findings require action.** The pre-existing-only blocker case (no new blocker recorded) is safe by construction and does not require a fix, though covering it with a test is appropriate alongside Finding 4.