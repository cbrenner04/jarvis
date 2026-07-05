## Verdict

**Required refinements:**

1. **Subspec 00 — `k`/`r` do not actually work on `awaiting-human` runs as claimed.**
   `activeRuns` entries are removed the moment a run converges to `awaiting-human`, so the plain `kill`/`resume` RPCs (which depend on an active-run lookup) don't apply to this state: `kill` returns `run_not_active`, and bare `resume` without a decision hits a `"Missing decision"` rejection. The daemon already has a working mechanism for terminating an `awaiting-human` run — the resume RPC's `decision: "abort"` branch. The spec must resolve this before refinement proceeds: either (a) route `k` on an `awaiting-human` run through `decision: "abort"` on the same resume RPC used for approve/revise, and re-scope what `r` means for this state (since plain resume has no effect here), or (b) explicitly narrow the claimed scope of `r`/`k` to state(s) where the existing RPCs actually apply and stop asserting they work on `awaiting-human` runs. Either way, the Decisions and Acceptance Criteria sections must describe behavior that matches the daemon's actual state handling, not an assumed reuse that doesn't hold for the target state the intent describes.

2. **Subspec 01 — new observability plumbing needs direct test coverage.**
   The acceptance criteria and task checklist currently only require *existing* suites to stay green, which checks for regressions but never exercises the new role-progress pointer/callback or the new review-debate row-building logic in `workflowStepSnapshot`. Since this is net-new behavior (not a refactor), it needs its own test coverage added to both the Task Checklist and Acceptance criteria, per the spec guidance's distinction between refactor ACs (cite existing tests) and new-behavior ACs (require new tests).

3. **Subspec 01 — clarify multi-cycle display semantics (minor).**
   `executeReviewDebate` loops through the four roles repeatedly across multiple cycles. Add a one-line decision stating the live-role pointer is cycle-agnostic and the row always reflects the current/latest cycle, so a role appearing to "restart" after a full cycle isn't misread as a bug by an implementer or reviewer.

**Not required:** the in-memory-only durability boundary for `review-debate` step progress is already adequately scoped by the existing "Deferred to first consumer" note; no further precision should be added there.