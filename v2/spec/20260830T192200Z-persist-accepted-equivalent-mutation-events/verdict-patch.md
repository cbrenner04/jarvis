Reviewing the implementation against the spec to verify the upheld issue and issue a verdict.


## Verdict

### Required outcomes

1. **Persist audit events at mutation-verification success, not only on full publication success.** The spec requires one `accepted_equivalent_mutation` event per verifier `acceptedSites` entry after successful completion mutation verification. Today, `acceptedSites` is only returned from the ready finalizer on the all-steps-succeed path and only appended via `appendCompletionVerificationOutcomes` on `publication.success`. If runtime smoke or the draft→ready flip fails afterward, those events are never written even though mutation verification already accepted equivalent sites. Because smoke-failure and ready-flip-failure are terminal and non-resumable, that audit evidence is permanently lost. This must be fixed on every completion path that runs publication-time mutation verification (write-loop ready finalizer and workflow-runner review-mutation-resume tail).

2. **Align operator/workflow documentation with the corrected emission point.** `v2/docs/workflow-runner.md` and related docs currently tie emission to “successful completion finalization.” They must state that events are written once mutation verification passes with accepted sites, independent of whether later publication-tail steps succeed or fail terminally.

3. **Add regression coverage for post-verification failure.** Existing tests cover successful completion only. Add at least one test that proves non-empty `acceptedSites` produce durable `accepted_equivalent_mutation` events when a subsequent publication-tail step fails terminally (runtime smoke or ready flip), and that the run log contains those events while completion still fails.

### Rationale

The decision ledger and tasks explicitly scope emission to verifier `acceptedSites` after successful mutation verification and forbid placeholder events when the list is empty. Coupling persistence to full finalization success contradicts that contract and defeats the spec’s goal: distinguishing reviewed equivalent-mutation exemptions from fully killed coverage in the durable run log, including on runs that do not complete cleanly.

### Not required

No change is required for JSONL append atomicity, cross-store crash consistency, or exactly-once retry semantics. The spec chose the existing `LogSink` replay path and per-site events in verifier order; it did not require transactional batching or crash-recovery guarantees beyond ordinary append behavior.