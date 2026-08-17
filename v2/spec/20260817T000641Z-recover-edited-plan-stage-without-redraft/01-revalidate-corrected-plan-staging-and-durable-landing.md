# Revalidate corrected plan staging and durable landing

## Problem

Recovery must not trust an operator edit or review-mutated stage, and a failed check must leave a correction recoverable without leaking any durable output.

## Decisions

- Reuse the normal plan shape, contract normalizer, staged-Markdown, and landing validation against staged bytes before the first review, after every review actuator that can change staging, and immediately before landing.
- Validation is effect-free: on any shape, normalizer, Markdown, landing, or post-review failure, retain byte-for-byte the staged snapshot that existed immediately before that failed validation. If a review changed the stage, its changed bytes are the retained snapshot; validators do not normalize or roll them back in place.
- A validation failure reports its normal named reason, invokes no later review, landing, publication, or ready-intent consumption, and produces no partial durable output.
- Durable plan content is exactly `index.md`, `intent.md`, and numbered subspec Markdown linked from the index. An unlinked numbered Markdown file is rejected as `unlinked_numbered_subspec`, remains in staging, and is never silently copied; ordinary and recovered landing use this same contract.

## Tasks

- Reuse clean-plan validation as a pure staged-byte check at each recovery and review boundary.
- Preserve the failed-validation snapshot and ready-intent while preventing all later effects and durable writes.
- Enforce the linked-numbered-file landing contract for ordinary and recovered plans.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` test `rejects an uncorrected recovered plan stage without side effects` retains the out-of-union `## Decisions` bullet, reports the normalizer reason, invokes neither review nor publication hooks, consumes nothing, preserves the stage byte-for-byte, and fails against the pre-fix code; its unique source directives invert every validation-before-effect and failure-retention guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `rejects an uncorrected recovered plan stage without side effects`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `retains each invalid recovered plan-stage snapshot before effects` independently drives shape, normalizer, staged-Markdown, and landing validation failures, asserts each named reason, and proves the snapshot and ready-intent remain unchanged with no review, publication, or durable output; its unique source directives invert every representative validation and retention guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `retains each invalid recovered plan-stage snapshot before effects`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `revalidates a review-mutated recovered plan stage before landing` makes a captured review actuator introduce a contract miss, reports the post-review validation reason, preserves the review-mutated stage and ready-intent, and proves no partial landing or publication occurs; its unique source directives invert every post-review revalidation guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `revalidates a review-mutated recovered plan stage before landing`; Mutation checkpoint:
- [ ] `v2/src/execution/publication-landing.test.ts` test `plan landing rejects unlinked numbered subspecs` proves ordinary and recovered landing both report `unlinked_numbered_subspec`, retain that staged file, and never place it in durable output; it fails against the pre-fix numbered-file behavior and its unique source directives invert every linked-file validation guard. `v2/src/execution/publication-landing.test.ts` — `plan landing rejects unlinked numbered subspecs`; Mutation checkpoint:

## Documentation updates

- `v2/docs/workflow-runner.md` — document validation before review, after mutating review, and before landing; name failure retention as the failed snapshot and explain that no ready-intent is consumed on rejection.
