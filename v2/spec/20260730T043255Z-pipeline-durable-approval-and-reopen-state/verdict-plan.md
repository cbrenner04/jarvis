1. Define approval states as execution semantics, not only persistence vocabulary: `awaiting` blocks progression, `approved` permits continuation, and `rejected` deterministically settles the pipeline. Pipeline-state derivation and execution tests must distinguish all three; “no later dispatch” applies only to an unreached/awaiting gate, not an approved one.

2. Make continuation operational after restart. Approval continuation and failed-pipeline reopen must restore or otherwise establish the pipeline-level state and ownership required to run; resetting stage rows alone is insufficient. Reconciliation, reopen, and activation semantics must compose without client reconstruction.

3. Require the production continuation path—not merely a direct resolver test—to load persisted admission context after the original process and store handle are gone. This is necessary to satisfy the intent’s explicit no-client-reconstruction guarantee.

4. Disambiguate stage identity throughout. Specify preservation and return contracts separately for the durable row identity (`PipelineStageRecord.id`) and authored stage key (`stageId`), including which identifier reopen returns.

5. Require approval boundary and decision operations to verify that the authored stage is `kind: "approval"`. Workflow stages, wrong stages, and invalid statuses must produce observable refusal without mutation.

6. Define caller-visible outcomes for conditional operations. Boundary writes, decisions, and reopen attempts must distinguish application from refusal, including duplicate decisions, losing concurrent writers, wrong-stage requests, and concurrent reopen attempts. First-writer-wins behavior cannot be verified through silent no-ops.

7. Fully define failed-pipeline reopen shape and races: the valid failed-plus-blocked-suffix form, the exact suffix scope, behavior for multiple failures or malformed later statuses, and atomic one-winner behavior under concurrent reopen. Tests must prove predecessor evidence and unrelated rows remain unchanged on both success and refusal.

8. Define approval-boundary write-failure behavior. A failed `pending → awaiting` transition must not be attributed to another stage, must not skip the suffix, and must leave a deterministic durable pipeline/stage outcome.

9. Split oversized work into independently testable slices. At minimum, separate context storage/migration, admission wiring, production continuation, approval operations, approval reconciliation/execution meaning, failed reopen, and skipped-suffix reconciliation where they cross independent seams. Context persistence, approval lifecycle, and failed reopen should become dependency-ordered specs if needed for PR-sized review and be planned serially where they share state-store vocabulary. Every original task and acceptance outcome must appear exactly once across replacements, every replacement must be index-linked, and each runtime slice must name its own pre-fix-failing and guard-inversion coverage.
