## Verdict — required outcomes

**1. `v2/docs/daemon-host.md` must not claim every publication-tail outcome settles `failed`.**
The added paragraph (operator-error section) says `surviving_mutation_failed` "(and every other publication-tail outcome) settles `failed`". That is false and contradicts the flip contract stated two paragraphs earlier: `ready_flip_failed` keeps the row `completed` and non-resumable, and the success path settles `completed` (`v2/src/execution/workflow-runner.ts:879`). The doc's real claim is about *which row* is settled, not which status. Reword so the row-redirect rule is stated independently of status, and the status per outcome stays as already documented.

**2. Owner selection in `workflowSurvivingMutationOwner` must stay confined to a `failed` rollup.**
Before this change, only a `~shrink` sibling could be an owner, and the rollup forces `failed` whenever a failed `~shrink` sibling exists — so the owner path was structurally reachable only under a `failed` rollup. Widening the match to *any* failed sibling drops that coupling: a `blocked` or `killed` rollup can now adopt a mutation owner's outcome fields and error, and the hand-built entry result (which no longer routes through `resultFrom`) also drops the `blocked`-only `worktreePath` key that `wait`'s contract requires. Restore the invariant explicitly by requiring the rollup status to be `failed` for owner adoption, and keep a test that pins it.

**3. The documented tie-break must be tested.**
Subspec 01 makes "with multiple candidates, the chronologically last terminal record wins" a decision, but no test constructs two owning siblings, so the rule is unenforced and free to regress silently. Add a case with two settled `failed` siblings carrying `surviving_mutation_failed` terminal records at different timestamps and assert the later one's detail reaches the entry.

**4. Subspec 00 AC 2 needs coverage at the seam it names.**
That criterion is ticked, but no test asserts `wait` on the redirected durable run id reports `runStatus: "failed"` with `error.reason: "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and mutation/file/line. The redirect is tested at the runner level and `composeRunOperatorError` is tested independently; the join of the two — the thing the criterion actually claims — is not. Add one test that exercises the redirected row through `wait`, or untick the criterion.

**5. Rename or re-scope the new "review step succeeded → entry completed" daemon test's role.**
It passes unchanged against pre-fix code and therefore is not guard-inversion evidence for subspec 01's inversion criterion (the positive review-owner test is). It is legitimate regression coverage for subspec 01's second criterion. Ensure the inversion criterion's evidence is the positive test, and don't present this one as proving the guard.

### Not upheld

- **Redirect placement before the publication guards** (success path returning `stepId: <review step>` with `runId: <shrink row>`): the alternative on that path is a synthesized run id no consumer can resolve; a real durable row is strictly better, and the pre-publication landing branch is unreachable when the last step is a non-durable review.
- **`in-progress` on the redirected row during finalization**: extends an already-accepted pattern; both in-process branches restore a terminal status. Crash-time strand hardening is out of scope.
- **Per-sibling log tails cost**: bounded to already-`failed` siblings under a settled entry rollup; negligible against work `list` already does.
- **Linked-write (`~link-N`) fallback miss**: the shrink lookup is keyed on the base step id, so linked routing still hits the primary lookup; when it doesn't, `settleRun === null` leaves the tail unchanged — fail-safe, not a regression. Optional hardening, not required here.