Reviewing the implementation and docs against the spec to issue a verdict.
## Verdict

Production code and tests satisfy the spec and acceptance criteria. The trailing `completionCommitError` column, JSON encoding, wait verbatim passthrough, and regressions are correct. **Required work is documentation only.**

### Required outcomes

1. **`write-behavior.md` must name `error.completionCommitError` on `run wait` stdout.**  
   The subspec requires documenting this field on wait output, not only the new list column. The wait table row and/or the passthrough paragraph must state that `error` may include `completionCommitError` (alongside other nested fields per `daemon-host.md`). Listing `error?` alone, with prose limited to `reason` / `retryable` / `nextAction`, does not meet the named documentation requirement.

2. **`operator-runbook.md` must not remove daemon-process-log guidance for non–completion-commit failure classes.**  
   The spec authorizes dropping that guidance only for `completion_commit_failed`. The edit removed “Daemon-process logs are secondary” from the shared paragraph covering `iteration_commit_failed`, `ready_gate_failed`, `landing_failed`, and `surviving_mutation_failed` as well. Restore secondary-log guidance for those other classes (e.g. split completion-commit guidance into its own clause, or scope the removal to `completion_commit_failed` only).

3. **`write-behavior.md` migration wording must not imply PR columns were added in this slice.**  
   The sixteen-column note currently reads as if both PR evidence and `completionCommitError` were appended here. PR columns pre-existed; this slice only appended column 16 (`completionCommitError`). Wording must reflect that accurately so script authors migrate on the right delta.

### No action required

- **Production code** — one trailing column in `formatListRunRow`; wait unchanged via existing verbatim `error` passthrough.
- **Tests** — acceptance criteria met; partial column pinning via indices 13–15 is sufficient; row-width, coexistence, and absent-on-other-error-path tests are optional hardening, not spec gaps.
- **`worktreePath` wait-table correction** — benign doc drift fix in the same row.
- **`v1-behaviors.md` citing `run-completion.ts`** — imprecise attribution (file unchanged); optional one-line tightening, not blocking.