Verifying critical claims in the codebase so the verdict rests on facts.


## Verdict: required refinements

1. **Problem statement and test framing for `interrupted` vs `killed`**  
   The spec must state that only **`killed`** is terminal-but-not-boundary today; **`interrupted`** already passes the boundary predicate. The production failure is reconciled **`killed`** rows (and JSDoc saying “non-terminal durable run” while the gate uses `isBoundaryTerminalRunStatus`). **`interrupted`** may appear in tests only as regression / no-op coverage, not as co-equal with the bug narrative.

2. **Store-error fail-closed: pick one contract and align all surfaces**  
   Intent, subspec **Decisions**, `checkEligibility` JSDoc, operator runbook, and the preservation AC for `returns ineligible if store throws` currently disagree: JSDoc and intent imply store errors → ineligible; the cited test documents **propagating throw**, not ineligible. The spec must **choose explicitly** whether store errors (a) stay throw-propagation (fail-closed by aborting cleanup) or (b) become ineligible like `gh`/daemon (with a deliberate test change). Subspec **Decisions** must include store errors on the same footing as `gh` and daemon once chosen. The preservation AC must match that choice—not “stay green” while intent still claims ineligible. Add a task to sync JSDoc (and runbook if needed) with the chosen semantics.

3. **Failing-test AC must anchor the status-matrix migration**  
   Per spec guidance, the AC for the `killed` flip must **name** the existing `correctly distinguishes terminal vs non-terminal statuses` test (or its direct successor), not only generic “extend” language. Tasks must require moving **`killed`** (and ideally all `TERMINAL_RUN_STATUSES`) to the eligible side of that loop and keeping non-terminal blockers. Optional cleanup of invalid statuses in that loop (`revising`, `awaiting-human`) can be scoped to “when touching the test” if desired.

4. **`.jarvis.lock` scope: abandon/stale-reset, not bulk eligibility**  
   Intent acceptance language must not imply the **default eligibility gate** consults lock; bulk retirement uses `checkEligibility` only. The lock AC belongs to **`runAbandonCommand`** (and aligns with existing daemon `isLive` abandon refusal). Refine intent so “cleanup still refuses retirement” names **`--abandon`** (and stale-reset if parity with runbook matters). The subspec should state that the new lock test **preserves abandon behavior**, not evidence for the durable-predicate change.

5. **`v1-behaviors.md` placement**  
   Documentation tasks must say **where** to record the change: extend the existing bulk-`cleanup` paragraph and/or add a **[v2 difference]** cleanup bullet. Catalog text should match code: terminal durable rows per **`TERMINAL_RUN_STATUSES`** (including **`killed`**) do not block merged worktree retirement—not only `killed`/`interrupted` by name.

6. **Predicate disambiguation in Decisions**  
   Add one decision that the gate uses **store** `isTerminalRunStatus` (or equivalent on durable `RunStatus`), not boundary-terminal or daemon/TUI terminal notions—so implementers do not swap the wrong helper.

**Rationale (summary):** Items 2–3 prevent a green implement run with wrong operator docs or a broken preservation AC (spec guidance: preservation ACs cite real behavior; new behavior needs a named pre-fix-failing test). Items 1, 4, and 5 remove factual and scope drift versus intent and the codebase. Item 6 bounds the one-line code change.

**No split required:** One subspec remains appropriate if the above clarifications land; core approach (`!isTerminalRunStatus`, boundary predicate untouched, daemon `isLive` independent) is sound and matches intent.