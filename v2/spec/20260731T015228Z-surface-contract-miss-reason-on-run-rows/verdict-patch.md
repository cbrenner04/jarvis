Reviewing the implementation and docs against the spec to issue a verdict.
## Verdict — required outcomes

1. **Last `contract_miss_detail` event governs projection (not last defined `failureReason`).**  
   List/wait `error.contractMissDetail` must reflect the chronologically last `contract_miss_detail` log event only: set the field when that event has `failureReason`; omit it when that event lacks `failureReason`, even if an earlier detail event had one. Today’s tail scan keeps the last non-undefined `failureReason` across the whole tail, which breaks reprompt/resume tails with multiple detail events and contradicts the subspec decision (“chronologically last `contract_miss_detail.failureReason`”), `operator-runbook.md`, and `write-behavior.md`.

2. **Unit coverage for multi-detail tails.**  
   Extend `run-operator-error.test.ts` so a tail with two `contract_miss_detail` events is exercised: at minimum, detail-with-reason followed by detail-without-reason must compose to today’s shape (no `contractMissDetail`). Add the converse (no-reason then reason) so last-event wins are pinned. The existing single-event negative case is insufficient for the reprompt/resume scenario called out in the spec.

3. **Align `daemon-host.md` omission wording with last-event semantics.**  
   After fixing projection, the operator-error prose must describe omission when the chronologically last `contract_miss_detail` lacks `failureReason` (not merely when no event in the tail carries one). Keep store-only / no-`logReader` omission unchanged.

4. **Update the Composition section in `daemon-host.md`.**  
   The **Composition** block still documents only `loadRun` + terminal log record. The subspec requires one documented boundary for log-tail input into the shared `composeRunOperatorError` path used by both `list` and `wait`. That section must state the optional log-tail argument, that `contractMissDetail` is sourced from it, and that enrichment is skipped when the tail is unavailable—matching the implemented seam and closing the doc gap left by the operator-error paragraph alone.

**Rationale:** Outcomes 1–3 close a real correctness hole on multi-detail tails and restore spec/doc/code agreement on “chronologically last.” Outcome 4 completes the subspec’s documented composition boundary without changing product scope. Recovery-copy updates, workflow-entry rollup tests, pipeline parity, empty-string guards, and `intent.md` hygiene are out of scope for this patch.