## Verdict

**Required refinements:**

1. **closePr failure handling** — Decisions must specify that `closePr` errors (including "already closed") are non-fatal: retire continues. An already-closed draft PR at retire time is a real race and must be treated symmetrically with best-effort remote-branch deletion. Add a Decision entry and an AC covering this case.

2. **Operation order** — The ordering (close PR → remove worktree → delete branches) is non-obvious and load-bearing: closing PR before branch deletion preserves the PR handle; worktree removal before branch deletion avoids a dangling entry. Move the ordering rationale into Decisions. AC #3 should assert the observable outcome (PR closed AND worktree/branches removed) rather than mandating call sequence.

3. **Merged-PR skip gate in Decisions** — A merged worktree also satisfies "not an open PR," so an implementer could omit the `isMergedPr` check and silently retire merged worktrees. The two-gate eligibility check (`isMergedPr` guard + `findMatchingOpenPrs`) must be named in Decisions to prevent the bug.

4. **Confirmation prompt gaps** — The spec inherits cleanup's confirm scaffold but no ACs verify: (a) `--dry-run` suppresses the prompt, and (b) operator decline cancels without side effects. Both are observable behaviors that must be covered.

5. **Dry-run output format** — "Previews exactly the eligible worktrees" implies a format that the spec doesn't define and that the implementation must choose. Per repo conventions, add an explicit inline deferral: `Deferred to first consumer: dry-run output format — pin when a caller needs it.`

6. **AC #7 tighten** — "Spec stays in place" passes trivially if the code simply never calls archive. Restate as a positive assertion: spec directory is present and unmodified after a retire completes.

7. **"Matching" definition** — Add a one-line inline definition of "matching" (same branch name, per `findMatchingOpenPrs`) in Decisions or Behavior to remove ambiguity at low cost.