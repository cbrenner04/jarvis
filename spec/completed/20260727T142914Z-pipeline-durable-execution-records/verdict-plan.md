1. Clarify the admission boundary: `createPipeline` receives an already validated definition; it does not itself guarantee validation. Do not require a new branded validation type unless already part of the prerequisite contract.

2. Define how a reopened pipeline retains executable meaning if source definitions change. Require either a durable execution-relevant definition/version reference or an explicit immutable/versioned lookup contract. Stable stage IDs and positions alone are insufficient for restart-safe orchestration.

3. State whether pipeline lifecycle status is stored or derived. If derived from stage records, make that explicit so later consumers do not assume an authoritative pipeline-status field.

4. Preserve the intent’s artifact and failure-detail deferral. Do not silently establish opaque JSON as the durable representation unless the spec explicitly adopts and justifies that storage envelope.

5. Define workflow linkage precisely as the existing workflow snapshot `invocationId`, including its nullability for undispatched or non-workflow stages. Avoid implying linkage to an individual workflow-run row or unsupported foreign-key integrity.

6. Specify lifecycle-update behavior sufficiently for deterministic persistence: initial nullable values, omitted versus explicit-null fields, whether values can be cleared, timestamp units, unknown-target handling, and a guarantee against silent no-op updates. Explicitly distinguish lossless storage from transition-policy enforcement; a full post-`pending` state machine may remain deferred.

7. Add legacy migration coverage. The spec must verify that a pre-change database upgrades without losing existing runs, attempts, or migration history; the new pipeline records then work and reopening remains idempotent. Testing only a newly created database does not establish migration safety.

8. Require deterministic proof of atomic rollback after partial stage insertion without treating an invalid definition as validated input.

9. Define and verify relational integrity for both stage identity and authored order, including uniqueness of stage IDs and positions within a pipeline and an actually enforced parent relationship or equivalent integrity guarantee.

10. Replace the generic guard-inversion criterion with focused negative outcomes for actual guards, including unknown-target rejection, duplicate stage/position prevention, and sibling-update isolation. Nullable fields and ordering outcomes should not be mislabeled as guards.

11. Split the current oversized subspec into independently testable serial subspecs, separating admission/schema/create-load-order-rollback work from lifecycle-update/reopen behavior. Every original task and acceptance outcome must appear exactly once across the replacements, and every replacement must be linked from `index.md`.
