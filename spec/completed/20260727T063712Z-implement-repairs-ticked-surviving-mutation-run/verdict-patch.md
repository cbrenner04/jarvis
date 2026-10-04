## Verdict — repairs required

1. **Enable the specified independent repair budgets.** Each mutation-repair attempt must permit up to three ready-gate repairs, for the documented maximum of 12 agent iterations. Current recovery disables ready-gate repair, violating subspec 01 and its composition criterion.

2. **Use authoritative spec-tree completion semantics.** Recovery must be attempted only when the same acceptance-criteria parser and linked-subspec traversal used by implement preflight determines the tree is complete. Human-only criteria, linked specs, and malformed/unreadable trees must retain existing semantics.

3. **Canonicalize recovery identity consistently.** Project root, spec path, project-relative path, and default branch must match ordinary implement resolution, including symlinked paths. Equivalent invocations must locate the same lineage.

4. **Guarantee terminal settlement.** Every admitted recovery must end completed or with a durable terminal failure, including unexpected repair, verification, commit, gate, and publication errors. No failure may leave the owning row `in-progress`.

5. **Preserve runtime-smoke evidence.** Successful and failed repaired publication paths must durably record any runtime-smoke outcome, matching normal finalization. Runtime smoke is a mandatory completion boundary.

6. **Track detached recovery as active daemon work.** After detached admission, recovery must prevent retirement shutdown until completion and release lifecycle/ownership state in all outcomes. Acceptance must not acknowledge work the daemon can abandon.

7. **Project exhaustion through workflow entry reporting.** `run list` and `run wait` on the workflow entry must surface a review-owned `mutation_repair_exhausted` outcome with `retryable: false` and `nextAction: "inspect_spec"`, preserving its operator guidance rather than masking it.
