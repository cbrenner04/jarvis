Upheld findings requiring refinement:

1. **`stateDbPath` deviates from intent without acknowledgment.** Intent says "optional state DB path"; the subspec makes it always-populated and explicitly rules out the optional variant. Either restore the optional behavior or add an explicit decision line stating this supersedes the intent, with the one-line rationale already present (unopened path is free for the non-consuming caller).

2. **Fixture module/export names are unpinned.** The task checklist says "`v2/src/testing/write-fixtures.ts` (or similarly named module)" and the AC "both import them from `v2/src/testing/`" is unverifiable without concrete names. Per spec guidance, harness subspecs may (and here should) name internal symbols when structure is the contract — pin the module filename and the three export names so the AC is mechanically checkable.

3. **Prerequisite not carried into decisions/AC.** The intent's stated prerequisite is that agent-runnable tests avoid real process spawn. The subspec never states this as a requirement of the extracted fixtures. Add a decision or AC that the shared fixtures (especially the fake external-worktree factory) never spawn a real subprocess or git worktree.

4. **Missing AC for cleanup-helper correctness.** The current AC only checks the absence of local `roots[]` loops, not that the shared cleanup helper actually removes temp roots after each test. Add an AC verifying no leaked temp directories after tests run.

5. **Marker-file degrade behavior is asserted, not verified.** The decision assumes the on-disk `.reused` marker check "degrades correctly" for `write.test.ts`'s simpler case, without confirming this against the current fakes in both files. Add a task-checklist step to verify (and adjust if needed) that the unified factory reproduces both files' existing `reused` behavior exactly, since scenario coverage must stay unchanged.

6. **Undocumented setup differences between the two files' Jarvis-home fixtures.** Beyond `stateDbPath`, add a task-checklist step to diff the two existing Jarvis-home setups (config content, scaffolding) before extraction, so any other divergence is surfaced and reconciled rather than silently dropped.

Not upheld: splitting into multiple subspecs is unnecessary — this is a single mechanical fixture migration with no new production behavior, appropriately scoped as one subspec per guidance's atomicity test.