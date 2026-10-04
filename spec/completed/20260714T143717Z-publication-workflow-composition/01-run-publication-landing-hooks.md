# Run publication landing hooks

Make post-write landing a closed hook contract and remove intent-specific output state from the runner.

## Decisions

- Use `intent-stage`, `plan-tree`, and `none` as the closed landing vocabulary; rules out output-domain conditionals in `workflow-runner.ts`.
- Run a publication row's landing hook after its final write/review boundary and before completion commit, push, PR, or durable no-Git completion; rules out publishing staging or landing before review.
- Persist the generic successful-work and pending-landing boundary so resume retries only landing and later publication; rules out rerunning split, draft, critic, or actuator work.
- `intent-stage` retains validation, isolation, ownership, transactional collision handling, staging retention, and durable ready-intent paths; rules out a weaker generic file copy.
- `plan-tree` validates and transactionally lands the staged index plus numbered subspecs at the precomputed durable spec path; rules out direct draft writes bypassing the row's staging/output contract.
- `none` performs no filesystem landing and preserves non-publication workflow behavior; rules out optional or undefined hook interpretation in the runner.
- Remove `intentOutput`, `deferredIntentOutput`, and their domain-specific runner branches after hook wiring; rules out layering hooks over the replaced path.
- Keep `workflow-runner.ts` and `write.ts` as files; rules out satisfying deletion through file splits.

## Tasks

- Implement the three landing hooks and row-selected output validation.
- Wire unreviewed and reviewed publication completion, durable checkpoints, and completion publication through the hook result.
- Remove replaced intent-specific runner/output surfaces and retain concise ownership boundaries.
- Update durable workflow and operator documentation with the composed behavior.

## Acceptance criteria

- [x] `v2/src/execution/publication-landing.test.ts` fails against the baseline and covers `intent-stage`, `plan-tree`, and `none`, including validation, atomic landing, collision, and returned durable publication path.
- [x] Updated `v2/src/execution/workflow-runner.test.ts` hook-driven completion cases fail against the baseline and prove landing precedes commit/push/PR or no-Git completion.
- [x] Intent split and plan draft publish the same durable outputs as before; staged control files are excluded and successful landing removes transient staging.
- [x] Reviewed intent lands only after review; a landing or later publication retry resumes from the durable post-work checkpoint without invoking split, draft, critic, or actuator again.
- [x] Intent boundary violations, differing collisions, and filesystem failures retain retryable staging and diagnostics without overwrite or partial durable output.
- [x] Plan draft shape failures and landing collisions retain retryable staging and never publish an incomplete spec tree.
- [x] `v2/src/execution/intent-output.test.ts` and the reviewed-intent landing/resume cases in `v2/src/execution/workflow-runner.test.ts` stay green (validation, ownership, collision, workspace, and resume behavior are unchanged).
- [x] Production code contains no `intentOutput` or `deferredIntentOutput`; replaced builder/deferred-landing production deletions exceed their replacement additions, and `workflow-runner.ts` plus `write.ts` remain intact.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` describe publication rows, hook ordering, ownership, durable output, failure, and resume semantics.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md`: document landing vocabulary, ordering, checkpoint/resume behavior, and ownership boundaries.
- `v2/docs/first-workflow-walkthrough.md`: document intent and plan staging, landing, failures, and durable destinations.
- `v2/docs/v1-behaviors.md`: keep the v1 parity catalog aligned with the composed v2 publication path.
