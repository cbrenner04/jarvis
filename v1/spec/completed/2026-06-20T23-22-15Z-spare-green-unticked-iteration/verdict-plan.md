## Verdict — Refinement Required

The design intent is sound and the two-mechanism bundling is justified, but the spec is under-specified on its load-bearing path (the re-entry control flow) and mis-states its own trigger. The following refinements are required before implementation.

### Must fix (block implementation)

1. **Restate the trigger and AC #1 honestly — no "green tree" precondition.** The exit-6 branch fires purely on *edited files + dirty worktree + no new tick*; the harness has no notion of test/correctness "greenness" and a test cannot establish one at the retry point. Remove "otherwise-green"/"clean-after-commit/green tree" framing from the problem statement and AC #1, and state plainly that the retry's safety comes from the **bound**, not from any greenness guarantee. The spec currently implies the harness distinguishes "green-needs-ticking" from "broken-not-done"; it does not.

2. **Pin the re-entry control flow and close the exit-4 hole.** Committing uncommitted ticks at iteration start does not change the working-tree file that `beforeCriteria` snapshots, so after the commit `after === before` with no progress flag set — a partially-completing re-entry then falls to **exit 4**, not exit 6. The spec asserts "do not fall into the no-progress branch" as a requirement but pins no mechanism. The refinement must commit to one explicit control flow (e.g., commit ticks → re-evaluate completion → loop back without spawning the agent that turn, OR fall through while setting the progress flags the exit-4 guard reads) and AC #4 must cover the **partial-tick** case (committed ticks that complete the spec only partially), not just full completion.

3. **Cover the deadlock-fix at `maxIterations = 1`.** The uncommitted-ticks-are-progress mechanism runs at iteration start, independent of the retry bound, and is the actual fix for the "ticks can never commit without manual intervention" deadlock. It must rescue a re-entered subspec even when the operator's ceiling permits no retry. Add a criterion asserting recovery at `maxIterations = 1`.

4. **Pin the commit scope for the start-of-iteration tick commit.** The reused commit helpers stage with `git add -A`, so in a worktree holding both uncommitted ticks and unrelated in-progress edits, that commit absorbs everything. State the intended scope explicitly (accepting the `-A` sweep as consistent with the existing commit path, or constraining it) rather than implying a tick-only commit.

### Must fix (minor, address in same pass)

5. **Pin `N`.** `N` is a load-bearing, cost-observable knob whose first consumer is this spec — deferral does not apply. Commit to `N = 2` in the decision; drop "default candidate / pin at implementation."

6. **Note the `N ≥ maxIterations` exit-code interaction.** When a small operator ceiling terminates the run mid-retry, the loop ceiling stops it instead of the exit-6 path, changing the exit code for an input that exits 6 today. State that this is acceptable (one sentence or a criterion).

7. **Drop the "reset on a blocker" rule** unless an intended within-run blocker-then-continue path exists. Blockers exit 7 and end the run, so a counter reset at termination is unobservable — a ledger entry that rules out no real alternative.

8. **Handle the absent-at-HEAD subspec.** The tick-diff assumes the subspec exists at HEAD; specify that absent-at-HEAD is treated as "no committed ticks."

9. **Confirm counter inertness during fix-up.** State in one line that the counter neither increments nor resets when `activeSubspecPath` is undefined (fix-up iterations), so it is not spuriously disturbed.

### Defensible — keep, but make explicit

- **Bundling the two mechanisms** is correct: the deadlock-fix is what stops the retry from re-deadlocking on its own uncommitted ticks, so they genuinely break each other if split. Add an explicit "deliberately not split, here's why" note to satisfy the one-change-per-subspec default.
- **AC #6 (never auto-ticks)** is legitimate, but because the deadlock-fix *does* commit agent-authored ticks, the test must use a fake agent that writes **zero** ticks anywhere — otherwise "committing the agent's ticks" is conflated with "harness auto-ticking." Call this out in the criterion's test note.

### Rationale

Items 1–3 are the load-bearing gaps: the spec's central guarantee ("advance instead of re-detecting no-progress") is currently an unpinned requirement contradicted by the actual `beforeCriteria`/exit-4 control flow, and its stated trigger references state the harness cannot observe — both violate the principle that acceptance criteria must verify observable behavior and that control flow drafted ahead of its mechanism be pinned, not implied. Items 4–9 are terse decision-ledger corrections: pin the one knob whose caller is present, name real alternatives or omit the entry, and close cheap edge cases so the single subspec stays independently testable.