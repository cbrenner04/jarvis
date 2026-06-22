## Verdict

The spec is sound and correctly scoped — a faithful mirror of plan's auto-ready path. Two cheap refinements are required; the rest are correctly handled or rejected.

### Required refinements

1. **Record the inherited ready-gate dependency.** Add one decision line noting that reusing plan's path inherits its `bun run ready` gate: a missing or failing gate warns and leaves the PR draft (the warn-and-continue path). This is load-bearing because a reader could otherwise assume "auto-ready" is unconditional; naming the inherited dependency rules out that misreading. The behavior itself is already chosen — this only records it.

2. **Reconcile the operator-facing next-steps string with the doc claim.** The documentation-updates section asserts the intent flow "no longer ends at draft," but the intent run's printed next-steps still tells the operator to "Review the draft PR" (it prints before auto-ready, matching plan's identical unchanged wording). Resolve the contradiction: either note that this string is intentionally left identical to plan's (consistency over a cosmetic divergence, since the PR is readied immediately after), or scope a wording update. State which, so the spec doesn't over-claim that nothing operator-facing still says "draft."

### Rejected / not required

- **No new code on the check:fix-commit or footer-staleness ordering.** Plan renders the PR footer before auto-ready and may emit a `check:fix` commit on a dirty tree; the spec deliberately inherits this rather than building a bespoke intent path that drifts from plan's gate. "Fixing" it on the intent side would be the divergence the central decision forbids. A markdown-only intent split makes a check:fix commit near-impossible anyway. At most a half-line note is acceptable; no AC.

- **Do not thread `agentLabel` into the auto-ready call.** Plan's own wrapper does not pass `agentLabel` to its ready path, so threading it on the intent side would make intent diverge from plan — the opposite of the spec's intent. The checklist's silence here is correct.

### Optional (refiner's discretion)

- An idempotency AC ("re-running on an already-ready PR is a no-op and still exits 0") pins a plausible re-run path. The reused none/draft/ready state guard already records this behavior, so it is polish, not a gap — add only if cheap.