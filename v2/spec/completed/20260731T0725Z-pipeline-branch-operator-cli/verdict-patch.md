Checking test coverage against the spec acceptance criteria.
## Verdict — required outcomes

1. **Add explicit guard-inversion coverage for branch-keyed observation (subspec 00 AC).**  
   Subspec 00 requires that inverting the branch-row projection guard or the `awaiting-approval` `branchKey` guard makes the two-branch regressions fail, and that **negative cases prove** collapsed projection and anonymous boundaries are absent. The landed tests only annotate inversion targets on positive cases; they do not include paired inversion tests (the pattern used elsewhere, e.g. `daemon-resume.test.ts`).  
   **Required:** Tests must fail when `branchKey` is omitted from `projectPipelineSnapshot` stage projection or from `derivePipelineBoundary` `awaiting-approval` envelopes, demonstrating that one-row-per-`stageId` collapse and anonymous approval boundaries cannot pass.

2. **Add explicit guard-inversion coverage for branch-keyed CLI approve/reject (subspec 01 AC).**  
   Subspec 01 requires that inverting the approve/reject `branchKey` RPC guard or the applied-vs-refused exit guard makes the branch-isolation regression fail, with negative cases proving the untouched branch stays `awaiting`. Current isolation tests prove correct RPC params and outcomes on the happy path; wrong-`branchKey` refusal is covered, but omission of `branchKey` from RPC params and inversion of applied/refused exit mapping are only comment checkpoints.  
   **Required:** Tests must fail when `branchKey` is dropped from `pipeline_approve` / `pipeline_reject` RPC params or when applied outcomes are treated as failure, so branch isolation cannot pass without the guards.

**Rationale:** Core behavior (per-row `branchKey` projection, branch-named `awaiting-approval` boundaries, three-operand approve/reject, aligned docs) matches the completed spec decisions and is adequately exercised by positive two-branch tests. The gap is acceptance-criteria test hygiene: subspecs explicitly demand negative inversion proof, not hypothetical “would fail if mutated” comments. That wording is binding for this slice.

**Not required in this patch:**  
- Restricting `awaiting-approval` boundaries to `awaiting` only (subspec 00 explicitly allows `pending`; approve friction in narrow fan-out windows is a documented follow-up, not a spec violation).  
- Handler-level `pipeline_wait` integration for aggregate `running` + branch `awaiting` (covered at `derivePipelineBoundary`; handler path uses the same function).  
- Mock-only CLI isolation re-proof of daemon admission (subspec 01 scopes CLI as thin RPC wrapper).  
- `intent.md` reconciliation (plan artifact; subspecs and `index.md` are complete).